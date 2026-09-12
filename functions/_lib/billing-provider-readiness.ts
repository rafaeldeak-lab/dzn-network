import { verifyCheckoutPrice } from "./billing-checkout";
import { stripeGetRequest } from "./stripe";
import type { Env } from "./types";

const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "invoice.payment_succeeded", "invoice.payment_failed"];
type Account = { id?: string; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean;
  country?: string; business_type?: string; requirements?: { disabled_reason?: unknown; currently_due?: unknown[]; past_due?: unknown[] } };
type Portal = { is_default?: boolean; active?: boolean; livemode?: boolean; features?: {
  payment_method_update?: { enabled?: boolean }; invoice_history?: { enabled?: boolean };
  subscription_cancel?: { enabled?: boolean; mode?: string };
} };
type Webhook = { url?: string; status?: string; livemode?: boolean; enabled_events?: string[] };
type Page<T> = { data?: T[]; has_more?: boolean };

export async function getBillingProviderReadiness(env: Env, expectedAccount: string, expectedWebhookFingerprint = "") {
  const checks = {
    liveKey: Boolean(env.STRIPE_SECRET_KEY?.startsWith("sk_live_")),
    accountMatches: false, accountCanCharge: false, accountCanPayOut: false, accountDetailsSubmitted: false,
    accountRequirementsClear: false, individualUkAccount: false,
    starterPrice: false, proPrice: false, defaultPortal: false, paymentMethodUpdates: false,
    cancellationAtPeriodEnd: false, invoiceHistory: false, webhookDestination: false, webhookEvents: false,
  };
  // This operator-only probe neither creates Checkout Sessions nor reconciles billing state.
  if (checks.liveKey && /^acct_[a-zA-Z0-9]{1,100}$/.test(expectedAccount)) {
    try {
      const account = await stripeGetRequest<Account>(env, "/account");
      checks.accountMatches = account?.id === expectedAccount;
      checks.accountCanCharge = account?.charges_enabled === true;
      checks.accountCanPayOut = account?.payouts_enabled === true;
      checks.accountDetailsSubmitted = account?.details_submitted === true;
      checks.individualUkAccount = account?.country === "GB" && account?.business_type === "individual";
      const requirements = account?.requirements;
      checks.accountRequirementsClear = Boolean(requirements && !requirements.disabled_reason &&
        Array.isArray(requirements.currently_due) && requirements.currently_due.length === 0 &&
        Array.isArray(requirements.past_due) && requirements.past_due.length === 0);
    } catch { /* Provider errors and identity details must never be returned or logged. */ }
    if (checks.accountMatches) {
      for (const plan of ["starter", "pro"] as const) {
        const price = plan === "starter" ? env.STRIPE_PRICE_STARTER : env.STRIPE_PRICE_PRO;
        if (!price || !/^price_[a-zA-Z0-9_]+$/.test(price)) continue;
        try { await verifyCheckoutPrice(env, price, plan, "live"); checks[`${plan}Price`] = true; } catch { /* Fail closed. */ }
      }
      try {
        const result = await stripeGetRequest<Page<Portal>>(env, "/billing_portal/configurations", { is_default: true, limit: 2 });
        const portal = result?.data?.[0];
        checks.defaultPortal = result?.has_more === false && result.data?.length === 1 &&
          portal?.is_default === true && portal.active === true && portal.livemode === true;
        if (checks.defaultPortal) {
          checks.paymentMethodUpdates = portal?.features?.payment_method_update?.enabled === true;
          checks.cancellationAtPeriodEnd = portal?.features?.subscription_cancel?.enabled === true &&
            portal.features.subscription_cancel.mode === "at_period_end";
          checks.invoiceHistory = portal?.features?.invoice_history?.enabled === true;
        }
      } catch { /* Fail closed without provider response details. */ }
      try {
        const result = await stripeGetRequest<Page<Webhook>>(env, "/webhook_endpoints", { limit: 100 });
        const matches = Array.isArray(result?.data) ? result.data.filter(item => item?.url === "https://dayz-network.com/api/stripe/webhook" && item.status === "enabled" && item.livemode === true) : [];
        checks.webhookDestination = result?.has_more === false && matches.length === 1;
        checks.webhookEvents = checks.webhookDestination && Array.isArray(matches[0].enabled_events) &&
          events.every(event => matches[0].enabled_events!.includes(event) || matches[0].enabled_events!.includes("*"));
      } catch { /* Fail closed without provider response details. */ }
    }
  }
  let webhookSigningSecretMatchVerified = false;
  if (checks.accountMatches && /^[a-f0-9]{64}$/.test(expectedWebhookFingerprint) && env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    webhookSigningSecretMatchVerified = fingerprint === expectedWebhookFingerprint;
  }
  return { ok: true, checkedAt: new Date().toISOString(), checks,
    providerConfigurationVerified: Object.values(checks).every(Boolean),
    webhookSigningSecretMatchVerified, endToEndPaymentVerified: false,
    productionMutationAllowed: false, checkoutActivatedByThisCheck: false };
}
