import { requireDb } from "./db";
import { ensureBillingSchema, ensureStarterTrialClaimSchema, findStarterTrialClaim } from "./plans";
import type { PurchasablePlanKey } from "../../lib/billing/plans";
import { billingRedirectUrl, STRIPE_API_VERSION, stripeFormRequest, stripeGetRequest, stripeId, type StripeCheckoutSession } from "./stripe";
import type { Env } from "./types";
import { RETURNING_STARTER_OFFER, RETURNING_STARTER_COPY, returningStarterOffer, type ReturningStarterOffer } from "../../lib/billing/returning-starter";

// Stop well before Stripe may prune an idempotency key after 24 hours.
export const CHECKOUT_RETRY_SECONDS = 23 * 60 * 60;
type Attempt = {
  id: string; discord_user_id: string; plan_key: PurchasablePlanKey; stripe_customer_id: string | null;
  stripe_mode: "test" | "live"; stripe_key_fingerprint: string; stripe_api_version: string; params_json: string;
  state: "prepared" | "request_started" | "session_ready" | "closed";
  first_requested_at: number | null; stripe_session_id: string | null;
};
type BillingAccount = { stripe_customer_id: string | null; stripe_subscription_id: string | null; plan_status: string };
export class CheckoutRecoveryError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409, readonly offer?: ReturningStarterOffer) { super(message); }
}
const retryError = () => new CheckoutRecoveryError("We could not confirm checkout yet. Please try again; your existing payment attempt will be reused.", "CHECKOUT_RETRY_REQUIRED", 503);
const now = () => Math.floor(Date.now() / 1000);

export async function createOrResumeCheckout(env: Env, request: Request, input: {
  discordUserId: string; planKey: PurchasablePlanKey; priceId: string; returnTo: string; acceptedOffer?: unknown;
}) {
  const db = requireDb(env);
  // No runtime schema creation for this ledger: missing migration must fail before Stripe.
  let attempt = await db.prepare("SELECT * FROM billing_checkout_attempts WHERE discord_user_id = ? AND state != 'closed' LIMIT 1")
    .bind(input.discordUserId).first<Attempt>();
  await ensureBillingSchema(env);
  const account = await db.prepare("SELECT stripe_customer_id, stripe_subscription_id, plan_status FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
    .bind(input.discordUserId).first<BillingAccount>();
  if (account?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(account.plan_status)) {
    throw new CheckoutRecoveryError("You already have a subscription. Use Manage billing to update payment details or change your plan.", "SUBSCRIPTION_EXISTS");
  }
  const fingerprint = await keyFingerprint(env.STRIPE_SECRET_KEY!);
  const mode = env.STRIPE_SECRET_KEY!.startsWith("sk_live_") ? "live" : "test";
  const verifiedPrices = new Set<string>();
  async function checkPrice(planKey: PurchasablePlanKey, priceId: unknown) {
    if (typeof priceId !== "string" || !/^price_[a-zA-Z0-9_]+$/.test(priceId)) throw priceError();
    const key = `${planKey}:${priceId}`;
    if (verifiedPrices.has(key)) return;
    await verifyCheckoutPrice(env, priceId, planKey, mode);
    verifiedPrices.add(key);
  }
  if (account?.stripe_customer_id) {
    const foreignAccount = await db.prepare("SELECT discord_user_id FROM owner_billing_accounts WHERE stripe_customer_id = ? AND discord_user_id != ? LIMIT 1")
      .bind(account.stripe_customer_id, input.discordUserId).first();
    if (foreignAccount) throw new CheckoutRecoveryError("Your payment account needs a support check before checkout.", "CHECKOUT_REVIEW_REQUIRED");
  }
  const claim = !attempt && input.planKey === "starter" ? await findStarterTrialClaim(env, {
    discordUserId: input.discordUserId, stripeCustomerId: account?.stripe_customer_id,
  }) : null;
  let paidConfirmation: string | null = null;
  if (claim) {
    // Another first-time request may have reserved the winning attempt while we waited.
    attempt = await db.prepare("SELECT * FROM billing_checkout_attempts WHERE discord_user_id = ? AND state != 'closed' LIMIT 1")
      .bind(input.discordUserId).first<Attempt>();
    if (!attempt) {
      if (claim.discord_user_id !== input.discordUserId || !account?.stripe_customer_id || !account.stripe_subscription_id ||
          claim.stripe_customer_id !== account.stripe_customer_id || !claim.stripe_subscription_id || claim.status === "checkout_created") {
        throw new CheckoutRecoveryError("Starter trial has already been used or reserved for this account or Stripe customer. Use Manage billing or contact support.", "STARTER_TRIAL_UNAVAILABLE");
      }
      await checkPrice("starter", input.priceId);
      paidConfirmation = await keyFingerprint(JSON.stringify([RETURNING_STARTER_OFFER, input.discordUserId,
        account.stripe_customer_id, account.stripe_subscription_id, claim.id, input.priceId, fingerprint]));
      requirePaidConfirmation(input.acceptedOffer, paidConfirmation);
    }
  }
  if (!attempt) {
    if (!paidConfirmation && input.acceptedOffer !== undefined) throw offerChanged();
    // Check the provider's immutable price fields before reserving an attempt or trial.
    await checkPrice(input.planKey, input.priceId);
    const customerId = account?.stripe_customer_id ?? null;
    const id = crypto.randomUUID();
    const params = {
      mode: "subscription", "line_items[0][price]": input.priceId, "line_items[0][quantity]": 1,
      ...(customerId ? { customer: customerId } : {}), payment_method_collection: "always",
      "payment_method_types[0]": "card", "adaptive_pricing[enabled]": false,
      client_reference_id: input.discordUserId,
      success_url: billingRedirectUrl(env, request, input.returnTo, "success"),
      cancel_url: billingRedirectUrl(env, request, input.returnTo, "cancelled"),
      "metadata[discord_user_id]": input.discordUserId, "metadata[plan_key]": input.planKey,
      "metadata[source]": "dzn-network", "metadata[dzn_checkout_attempt_id]": id,
      "subscription_data[metadata][discord_user_id]": input.discordUserId,
      "subscription_data[metadata][plan_key]": input.planKey, "subscription_data[metadata][source]": "dzn-network",
      ...(paidConfirmation ? {
        "metadata[dzn_paid_offer]": RETURNING_STARTER_OFFER,
        "metadata[dzn_paid_confirmation]": paidConfirmation,
        "custom_text[submit][message]": RETURNING_STARTER_COPY,
      } : {}),
      ...(input.planKey === "starter" && !paidConfirmation ? {
        "subscription_data[trial_period_days]": 2,
        "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
      } : {}), allow_promotion_codes: false,
    };
    await db.prepare(`INSERT INTO billing_checkout_attempts
      (id, discord_user_id, plan_key, stripe_customer_id, stripe_mode, stripe_key_fingerprint,
       stripe_api_version, params_json, state, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?
      WHERE 1 ${paidConfirmation ? `AND (
        EXISTS (SELECT 1 FROM owner_billing_accounts WHERE discord_user_id = ? AND stripe_customer_id = ?
          AND stripe_subscription_id = ? AND plan_status IN ('canceled', 'incomplete_expired'))
        AND EXISTS (SELECT 1 FROM owner_starter_trial_claims WHERE id = ? AND discord_user_id = ?
          AND stripe_customer_id = ? AND stripe_subscription_id IS NOT NULL AND status != 'checkout_created')
        AND NOT EXISTS (SELECT 1 FROM owner_billing_accounts WHERE stripe_customer_id = ? AND discord_user_id != ?)
      )` : ""} ON CONFLICT DO NOTHING`)
      .bind(id, input.discordUserId, input.planKey, customerId, mode, fingerprint, STRIPE_API_VERSION, JSON.stringify(params), now(), now(),
        ...(paidConfirmation ? [input.discordUserId, customerId, account?.stripe_subscription_id ?? null,
          claim?.id ?? null, input.discordUserId, customerId, customerId, input.discordUserId] : [])).run();
    // The uniqueness constraint chooses the winner across simultaneous requests.
    attempt = await db.prepare("SELECT * FROM billing_checkout_attempts WHERE discord_user_id = ? AND state != 'closed' LIMIT 1")
      .bind(input.discordUserId).first<Attempt>();
    if (!attempt) throw retryError();
  }
  const assignedCustomer = attempt.stripe_customer_id === null && Boolean(account?.stripe_customer_id);
  if (attempt.stripe_key_fingerprint !== fingerprint || attempt.stripe_mode !== mode ||
      ((account?.stripe_customer_id ?? null) !== attempt.stripe_customer_id &&
        !(assignedCustomer && attempt.stripe_session_id && account?.stripe_subscription_id))) {
    throw new CheckoutRecoveryError("Your earlier checkout needs a support check before another can be started.", "CHECKOUT_REVIEW_REQUIRED");
  }
  const frozen = JSON.parse(attempt.params_json) as Record<string, unknown>;
  const isPaidStarter = attempt.plan_key === "starter" && frozen["metadata[dzn_paid_offer]"] === RETURNING_STARTER_OFFER;
  if (isPaidStarter && attempt.plan_key !== input.planKey) {
    if (!attempt.stripe_session_id) throw planConflict();
    // A different plan may inspect/close a completed or expired Session, but never open this paid offer.
  } else if (isPaidStarter) requirePaidConfirmation(input.acceptedOffer, String(frozen["metadata[dzn_paid_confirmation]"]));
  else if (input.acceptedOffer !== undefined) throw offerChanged();
  if (attempt.stripe_session_id) {
    const session = await stripeGetRequest<StripeCheckoutSession>(env, `/checkout/sessions/${encodeURIComponent(attempt.stripe_session_id)}`).catch(() => { throw retryError(); });
    verifySession(attempt, session);
    // Stripe can assign a new customer at completion. Only inspect that exact completed checkout;
    // never rewrite the frozen request or use its old idempotency key with a different customer.
    if (assignedCustomer && (session.status !== "complete" || stripeId(session.customer) !== account?.stripe_customer_id ||
        stripeId(session.subscription) !== account?.stripe_subscription_id)) {
      throw new CheckoutRecoveryError("Your earlier checkout needs a support check before another can be started.", "CHECKOUT_REVIEW_REQUIRED");
    }
    if (session.status === "expired") {
      await closeExpiredAttempt(env, attempt);
      throw new CheckoutRecoveryError("Your previous checkout expired without completing. Please choose your plan again.", "CHECKOUT_EXPIRED");
    }
    if (session.status === "complete") {
      if (account?.stripe_subscription_id && account.stripe_subscription_id === stripeId(session.subscription) && ["canceled", "incomplete_expired"].includes(account.plan_status)) {
        const closed = await db.prepare(`UPDATE billing_checkout_attempts SET state = 'closed', updated_at = ?
          WHERE id = ? AND discord_user_id = ? AND stripe_session_id = ? AND state = 'session_ready'
          AND EXISTS (SELECT 1 FROM owner_billing_accounts WHERE discord_user_id = ?
            AND stripe_customer_id IS ? AND stripe_subscription_id = ? AND plan_status IN ('canceled', 'incomplete_expired'))
          AND NOT EXISTS (SELECT 1 FROM owner_billing_accounts WHERE stripe_customer_id = ? AND discord_user_id != ?)`)
          .bind(now(), attempt.id, input.discordUserId, session.id, input.discordUserId,
            stripeId(session.customer), stripeId(session.subscription), stripeId(session.customer), input.discordUserId).run();
        if (closed.meta.changes !== 1) throw retryError();
      }
      throw new CheckoutRecoveryError("This checkout has completed. Check Manage billing before starting another payment.", "CHECKOUT_COMPLETED");
    }
    if (attempt.plan_key !== input.planKey) throw planConflict();
    await checkPrice(attempt.plan_key, frozen["line_items[0][price]"]);
    await attachTrialSession(env, attempt, session);
    return { url: openSessionUrl(session) };
  }
  if (attempt.plan_key !== input.planKey) throw planConflict();
  if (attempt.first_requested_at !== null &&
      (now() - attempt.first_requested_at >= CHECKOUT_RETRY_SECONDS || now() < attempt.first_requested_at)) {
    throw new CheckoutRecoveryError("Your earlier checkout needs a support check. We will not risk creating a second payment.", "CHECKOUT_REVIEW_REQUIRED");
  }
  // Retries verify the frozen price, never a newly configured replacement or caller price.
  await checkPrice(attempt.plan_key, frozen["line_items[0][price]"]);
  if (hasStarterTrial(attempt)) await reserveAttemptTrial(env, attempt);
  await db.prepare(`UPDATE billing_checkout_attempts SET state = 'request_started',
    first_requested_at = COALESCE(first_requested_at, ?), updated_at = ?
    WHERE id = ? AND discord_user_id = ? AND state IN ('prepared', 'request_started')`)
    .bind(now(), now(), attempt.id, input.discordUserId).run();
  const current = await db.prepare("SELECT * FROM billing_checkout_attempts WHERE id = ? AND discord_user_id = ?")
    .bind(attempt.id, input.discordUserId).first<Attempt>();
  if (!current || current.state === "closed" || current.first_requested_at === null) throw retryError();
  if (now() - current.first_requested_at >= CHECKOUT_RETRY_SECONDS || now() < current.first_requested_at) {
    throw new CheckoutRecoveryError("Your earlier checkout needs a support check. We will not risk creating a second payment.", "CHECKOUT_REVIEW_REQUIRED");
  }
  let session: StripeCheckoutSession;
  try {
    session = await stripeFormRequest<StripeCheckoutSession>(env, "/checkout/sessions", JSON.parse(current.params_json), {
      idempotencyKey: `dzn-checkout-${current.id}`, apiVersion: current.stripe_api_version,
    });
  } catch {
    // A timeout, 4xx/5xx or bad response is not proof that no Session exists.
    throw retryError();
  }
  verifySession(current, session);
  const saved = await db.prepare(`UPDATE billing_checkout_attempts SET stripe_session_id = ?, state = 'session_ready', updated_at = ?
    WHERE id = ? AND discord_user_id = ? AND state IN ('request_started', 'session_ready')
    AND (stripe_session_id IS NULL OR stripe_session_id = ?)`)
    .bind(session.id, now(), current.id, input.discordUserId, session.id).run();
  if (saved.meta.changes !== 1) throw retryError();
  if (session.status !== "open") throw new CheckoutRecoveryError("Your checkout status has changed. Please try again to check it safely.", "CHECKOUT_STATUS_CHANGED");
  await attachTrialSession(env, current, session);
  return { url: openSessionUrl(session) };
}

async function reserveAttemptTrial(env: Env, attempt: Attempt) {
  await ensureStarterTrialClaimSchema(env);
  const db = requireDb(env);
  const timestamp = new Date().toISOString();
  await db.prepare(`INSERT INTO owner_starter_trial_claims
    (id, discord_user_id, stripe_customer_id, status, claimed_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM billing_checkout_attempts WHERE id = ? AND state != 'closed')
    ON CONFLICT DO NOTHING`)
    .bind(attempt.id, attempt.discord_user_id, attempt.stripe_customer_id, "checkout_created", timestamp, timestamp, attempt.id).run();
  const claim = await findStarterTrialClaim(env, { discordUserId: attempt.discord_user_id, stripeCustomerId: attempt.stripe_customer_id });
  if (claim?.id !== attempt.id || claim.discord_user_id !== attempt.discord_user_id || claim.stripe_subscription_id || claim.status !== "checkout_created") {
    throw new CheckoutRecoveryError("Starter trial has already been used or reserved for this account. Use Manage billing or contact support.", "STARTER_TRIAL_UNAVAILABLE");
  }
}

async function attachTrialSession(env: Env, attempt: Attempt, session: StripeCheckoutSession) {
  if (!hasStarterTrial(attempt)) return;
  // Never downgrade a claim already updated by a fast payment webhook.
  await requireDb(env).prepare(`UPDATE owner_starter_trial_claims SET checkout_session_id = ?, updated_at = ?
    WHERE id = ? AND discord_user_id = ? AND status = 'checkout_created' AND stripe_subscription_id IS NULL
    AND (checkout_session_id IS NULL OR checkout_session_id = ?)`)
    .bind(session.id, new Date().toISOString(), attempt.id, attempt.discord_user_id, session.id).run();
}

async function closeExpiredAttempt(env: Env, attempt: Attempt) {
  const db = requireDb(env);
  await db.batch([
    db.prepare("UPDATE billing_checkout_attempts SET state = 'closed', updated_at = ? WHERE id = ? AND discord_user_id = ? AND stripe_session_id = ?")
      .bind(now(), attempt.id, attempt.discord_user_id, attempt.stripe_session_id),
    // Only a provider-confirmed expired checkout can release this exact unused claim.
    db.prepare(`DELETE FROM owner_starter_trial_claims WHERE id = ? AND discord_user_id = ?
      AND status = 'checkout_created' AND stripe_subscription_id IS NULL
      AND (checkout_session_id IS NULL OR checkout_session_id = ?)
      AND EXISTS (SELECT 1 FROM billing_checkout_attempts WHERE id = ? AND state = 'closed')`)
      .bind(attempt.id, attempt.discord_user_id, attempt.stripe_session_id, attempt.id),
  ].slice(0, hasStarterTrial(attempt) ? 2 : 1));
}

function hasStarterTrial(attempt: Attempt) {
  return attempt.plan_key === "starter" && JSON.parse(attempt.params_json)["subscription_data[trial_period_days]"] === 2;
}
function requirePaidConfirmation(accepted: unknown, confirmation: string) {
  if (accepted !== confirmation) throw new CheckoutRecoveryError(RETURNING_STARTER_COPY,
    "STARTER_PAID_CONFIRMATION_REQUIRED", 409, returningStarterOffer(confirmation));
}
function offerChanged() {
  return new CheckoutRecoveryError("Your checkout terms have changed. Please choose your plan again.", "CHECKOUT_OFFER_CHANGED");
}
function priceError() {
  return new CheckoutRecoveryError("Plan pricing needs a support check before checkout. No new payment has been started.", "CHECKOUT_PRICE_REVIEW_REQUIRED", 503);
}
export async function verifyCheckoutPrice(env: Env, priceId: string, planKey: PurchasablePlanKey, mode: string) {
  const price = await stripeGetRequest<{
    id: string; active: boolean; livemode: boolean; currency: string; unit_amount: number; type: string;
    billing_scheme: string; transform_quantity?: unknown; custom_unit_amount?: unknown;
    recurring?: { interval: string; interval_count: number; usage_type: string };
  }>(env, `/prices/${encodeURIComponent(priceId)}`).catch(() => {
    throw new CheckoutRecoveryError("We could not verify the plan price. Checkout is unavailable; please try again.", "CHECKOUT_PRICE_UNAVAILABLE", 503);
  });
  if (!price || price.id !== priceId || price.active !== true || price.livemode !== (mode === "live") ||
      price.currency !== "gbp" || price.unit_amount !== (planKey === "starter" ? 200 : 1000) || price.type !== "recurring" || price.billing_scheme !== "per_unit" ||
      price.transform_quantity || price.custom_unit_amount || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed") {
    throw priceError();
  }
}

function verifySession(attempt: Attempt, session: StripeCheckoutSession) {
  if (!session || !/^cs_[a-zA-Z0-9_]+$/.test(session.id) ||
      (attempt.stripe_session_id && attempt.stripe_session_id !== session.id) || session.mode !== "subscription" ||
      session.livemode !== (attempt.stripe_mode === "live") || session.client_reference_id !== attempt.discord_user_id ||
      session.metadata?.discord_user_id !== attempt.discord_user_id || session.metadata?.dzn_checkout_attempt_id !== attempt.id ||
      session.metadata?.plan_key !== attempt.plan_key || !["open", "complete", "expired"].includes(session.status ?? "") ||
      (attempt.stripe_customer_id && stripeId(session.customer) !== attempt.stripe_customer_id)) {
    throw new CheckoutRecoveryError("Checkout could not be verified. Please contact support before trying another payment.", "CHECKOUT_VERIFICATION_FAILED", 502);
  }
}

function openSessionUrl(session: StripeCheckoutSession) {
  let url: URL;
  try { url = new URL(session.url ?? ""); } catch { throw retryError(); }
  if (session.status !== "open" || url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port ||
      !Number.isSafeInteger(session.expires_at) || session.expires_at! <= now()) throw retryError();
  return url.toString();
}
function planConflict() { return new CheckoutRecoveryError("You already have a checkout for another plan. Finish that checkout or wait for it to expire.", "CHECKOUT_PLAN_CONFLICT"); }
async function keyFingerprint(secret: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
