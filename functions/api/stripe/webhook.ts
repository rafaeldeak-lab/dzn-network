import { json, methodNotAllowed } from "../../_lib/http";
import {
  ensureBillingSchema,
  getPlanFromStripePriceId,
  normalizePlanKey,
  upsertStarterTrialClaimFromStripe,
  upsertBillingAccount,
} from "../../_lib/plans";
import { syncServerSubscriptionsForOwner } from "../../_lib/automation";
import {
  retrieveStripeSubscription,
  stripeId,
  stripeSubscriptionPeriodEnd,
  stripeSubscriptionPeriodStart,
  stripeSubscriptionPriceId,
  verifyStripeWebhook,
  type StripeSubscription,
} from "../../_lib/stripe";
import type { Env, PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "Stripe webhook is not configured." }, { status: 503 });

  let event;
  try {
    event = await verifyStripeWebhook(request, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid Stripe webhook." }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(env, event.data.object);
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded" || event.type === "invoice.payment_failed") {
      await handleInvoiceEvent(env, event.data.object);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await handleSubscriptionLikeEvent(env, event.data.object, event.type);
    }
    console.log("DZN STRIPE WEBHOOK PROCESSED", { type: event.type });
    return json({ received: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not process Stripe webhook." }, { status: 500 });
  }
};

async function handleCheckoutCompleted(env: Env, object: Record<string, unknown>) {
  const metadata = metadataRecord(object.metadata);
  const discordUserId = metadata.discord_user_id;
  if (!discordUserId) return;
  if (object.mode !== "subscription") throw new Error("Expected subscription checkout.");
  const subscriptionId = stripeId(object.subscription);
  const subscription = await resolveSubscription(env, object);
  const planKey = getPlanFromStripePriceId(env, stripeSubscriptionPriceId(subscription));
  if (planKey === "free") throw new Error("Checkout subscription price is not configured for DZN.");
  const customerId = stripeId(subscription.customer);
  if (planKey === "starter") {
    await upsertStarterTrialClaimFromStripe(env, {
      discordUserId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      checkoutSessionId: stripeId(object.id),
      status: subscription.status,
    });
  }
  await upsertBillingAccount(env, {
    discordUserId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planKey,
    planStatus: subscription.status,
    currentPeriodStart: stripeSubscriptionPeriodStart(subscription),
    currentPeriodEnd: stripeSubscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
  await syncServerSubscriptionsForOwner(env, discordUserId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: stripeSubscriptionPriceId(subscription),
    planKey,
    status: subscription.status,
    currentPeriodStart: stripeSubscriptionPeriodStart(subscription),
    currentPeriodEnd: stripeSubscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
}

async function handleSubscriptionLikeEvent(env: Env, object: Record<string, unknown>, eventType: string) {
  if (object.object !== "subscription") throw new Error("Expected subscription event.");
  const subscription = await resolveSubscription(env, {
    subscription: object.id,
    customer: object.customer,
  });
  if (eventType === "customer.subscription.deleted" && subscription.status !== "canceled") {
    throw new Error("Subscription cancellation could not be verified. Retry delivery.");
  }
  await reconcileSubscription(env, subscription, false);
}

async function handleInvoiceEvent(env: Env, object: Record<string, unknown>) {
  const legacyId = stripeId(object.subscription);
  const nestedId = nestedInvoiceSubscriptionId(object);
  if (legacyId && nestedId && legacyId !== nestedId) throw new Error("Invoice subscription identity is ambiguous.");
  const subscriptionId = legacyId ?? nestedId;
  // One-off invoices must never change subscription access by matching a customer alone.
  if (!subscriptionId) return;
  const subscription = await resolveSubscription(env, { subscription: subscriptionId, customer: object.customer });
  await reconcileSubscription(env, subscription, true);
}

async function reconcileSubscription(env: Env, subscription: StripeSubscription, requireExistingSubscription: boolean) {
  const customerId = stripeId(subscription.customer)!;
  const subscriptionId = subscription.id;
  let planKey = getPlanFromStripePriceId(env, stripeSubscriptionPriceId(subscription));
  if (planKey === "free" && ["active", "trialing"].includes(subscription.status)) {
    throw new Error("Subscription price is not configured for DZN.");
  }
  const currentPeriodStart = stripeSubscriptionPeriodStart(subscription);
  const currentPeriodEnd = stripeSubscriptionPeriodEnd(subscription);
  const terminal = subscription.status === "canceled" || subscription.status === "incomplete_expired";
  if ((!terminal && (!currentPeriodStart || !currentPeriodEnd)) ||
      (currentPeriodStart && currentPeriodEnd && currentPeriodStart >= currentPeriodEnd) ||
      (subscription.cancel_at_period_end !== undefined && typeof subscription.cancel_at_period_end !== "boolean")) {
    throw new Error("Subscription billing period could not be verified.");
  }
  const metadataOwner = stringOrNull(metadataRecord(subscription.metadata).discord_user_id);
  await ensureBillingSchema(env);
  // Check every matching identity, not a customer/subscription OR query with LIMIT 1.
  const accounts = await env.DB!.prepare(
    `SELECT discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key FROM owner_billing_accounts
     WHERE stripe_customer_id = ? OR stripe_subscription_id = ? OR discord_user_id = ? LIMIT 2`,
  ).bind(customerId, subscriptionId, metadataOwner).all<{
    discord_user_id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; plan_key: string;
  }>();
  if (!accounts.success || !accounts.results) throw new Error("Subscription account lookup failed. Retry delivery.");
  const matches = accounts.results;
  if (matches.length > 1) throw new Error("Subscription account identity is ambiguous.");
  const account = matches[0];
  if (account && ((metadataOwner && metadataOwner !== account.discord_user_id) ||
      (account.stripe_customer_id && account.stripe_customer_id !== customerId))) {
    throw new Error("Subscription account identity could not be verified.");
  }
  // A replaced subscription cannot overwrite the account's current subscription.
  if (account?.stripe_subscription_id && account.stripe_subscription_id !== subscriptionId) return;
  if (requireExistingSubscription && account?.stripe_subscription_id !== subscriptionId) return;
  if (planKey === "free") {
    // Removed Price bindings must not prevent revocation of an exact existing subscription.
    if (account?.stripe_subscription_id !== subscriptionId) throw new Error("Subscription price is not configured for DZN.");
    planKey = normalizePlanKey(account.plan_key);
  }
  const discordUserId = account?.discord_user_id ?? metadataOwner;
  if (!discordUserId) return;
  if (!account?.stripe_subscription_id && !metadataOwner) throw new Error("Subscription account proof is missing.");
  const status = subscription.status;
  if (planKey === "starter") {
    await upsertStarterTrialClaimFromStripe(env, {
      discordUserId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status,
    });
  }
  await upsertBillingAccount(env, {
    discordUserId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planKey,
    planStatus: status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
  await syncServerSubscriptionsForOwner(env, discordUserId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: stripeSubscriptionPriceId(subscription),
    planKey,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
}

async function resolveSubscription(env: Env, object: Record<string, unknown>): Promise<StripeSubscription> {
  const subscriptionId = stripeId(object.subscription);
  const customerId = stripeId(object.customer);
  if (!subscriptionId || !customerId) throw new Error("Checkout subscription identity is missing.");
  // Re-read even expanded snapshots: a delayed checkout event may describe old access.
  const subscription = await retrieveStripeSubscription(env, subscriptionId).catch(() => {
    throw new Error("Checkout subscription could not be verified. Retry delivery.");
  });
  if (!subscription || subscription.id !== subscriptionId || stripeId(subscription.customer) !== customerId) {
    throw new Error("Checkout subscription identity could not be verified.");
  }
  if (!["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"].includes(subscription.status)) {
    throw new Error("Checkout subscription status could not be verified.");
  }
  return subscription;
}

function metadataRecord(value: unknown) {
  if (!value || typeof value !== "object") return {} as Record<string, string>;
  const metadata: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") metadata[key] = item;
  }
  return metadata;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function nestedInvoiceSubscriptionId(object: Record<string, unknown>) {
  const parent = object.parent;
  if (!parent || typeof parent !== "object") return null;
  if ((parent as { type?: unknown }).type !== "subscription_details") return null;
  const details = (parent as { subscription_details?: unknown }).subscription_details;
  if (!details || typeof details !== "object") return null;
  return stripeId((details as { subscription?: unknown }).subscription);
}
