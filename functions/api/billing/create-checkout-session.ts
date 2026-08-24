import { ensureMockUser, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import {
  attachStarterTrialCheckoutSession,
  ensureBillingSchema,
  getCheckoutSafetyStatus,
  getStripePriceIdForPlan,
  paidPlanKey,
  releaseStarterTrialReservation,
  reserveStarterTrialClaim,
} from "../../_lib/plans";
import { billingRedirectUrl, stripeFormRequest, type StripeCheckoutSession } from "../../_lib/stripe";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type CheckoutBody = {
  plan_key?: string;
  returnTo?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<CheckoutBody>(request);
  const planKey = paidPlanKey(body.plan_key);
  if (!planKey) return json({ error: "Choose a paid plan." }, { status: 400 });

  const priceId = getStripePriceIdForPlan(env, planKey);
  if (!priceId) return json({ error: "Plan checkout is not configured yet." }, { status: 400 });

  const checkoutSafety = getCheckoutSafetyStatus(env);
  if (!checkoutSafety.checkoutSessionCreationAllowed) {
    return json({
      error: checkoutSafety.checkoutBlockedReason ?? "Checkout is not enabled yet.",
      errorCode: checkoutSafety.checkoutSafetyMode === "live_checkout_paused" ? "LIVE_CHECKOUT_PAUSED" : "CHECKOUT_NOT_ENABLED",
      checkoutSafetyMode: checkoutSafety.checkoutSafetyMode,
    }, { status: 403 });
  }

  await ensureBillingSchema(env);
  const account = await requireDb(env)
    .prepare("SELECT stripe_customer_id FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
    .bind(user.discord_id)
    .first<{ stripe_customer_id: string | null }>();

  const stripeCustomerId = account?.stripe_customer_id ?? null;
  const starterTrialReservation = planKey === "starter"
    ? await reserveStarterTrialClaim(env, { discordUserId: user.discord_id, stripeCustomerId })
    : null;
  if (starterTrialReservation && !starterTrialReservation.reserved) {
    return json({ error: "Starter trial has already been used for this DZN account or Stripe customer. Choose Pro or manage billing." }, { status: 409 });
  }

  let session: StripeCheckoutSession;
  try {
    session = await stripeFormRequest<StripeCheckoutSession>(env, "/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      customer: stripeCustomerId ?? undefined,
      payment_method_collection: "always",
      client_reference_id: user.discord_id,
      success_url: billingRedirectUrl(env, request, body.returnTo ?? "/dashboard", "success"),
      cancel_url: billingRedirectUrl(env, request, body.returnTo ?? "/dashboard", "cancelled"),
      "metadata[discord_user_id]": user.discord_id,
      "metadata[plan_key]": planKey,
      "metadata[source]": "dzn-network",
      "subscription_data[metadata][discord_user_id]": user.discord_id,
      "subscription_data[metadata][plan_key]": planKey,
      "subscription_data[metadata][source]": "dzn-network",
      ...(planKey === "starter" ? {
        "subscription_data[trial_period_days]": 2,
        "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
      } : {}),
      allow_promotion_codes: false,
    });
  } catch (error) {
    if (starterTrialReservation?.reserved) {
      await releaseStarterTrialReservation(env, { discordUserId: user.discord_id });
    }
    throw error;
  }

  if (!session.url) {
    if (starterTrialReservation?.reserved) {
      await releaseStarterTrialReservation(env, { discordUserId: user.discord_id });
    }
    return json({ error: "Stripe checkout did not return a URL." }, { status: 502 });
  }
  if (starterTrialReservation?.reserved) {
    await attachStarterTrialCheckoutSession(env, {
      discordUserId: user.discord_id,
      stripeCustomerId: session.customer ?? stripeCustomerId,
      stripeSubscriptionId: session.subscription,
      checkoutSessionId: session.id,
      status: "checkout_created",
    });
  }
  console.log("DZN STRIPE CHECKOUT SESSION CREATED", { planKey });
  return json({ url: session.url });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}
