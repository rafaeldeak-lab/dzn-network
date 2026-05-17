import { json, methodNotAllowed } from "../../_lib/http";
import {
  findBillingAccountByCustomerOrSubscription,
  getPlanFromStripePriceId,
  normalizePlanKey,
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
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed"
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
  const subscriptionId = stripeId(object.subscription);
  const subscription = await resolveSubscription(env, object);
  const pricePlan = subscription ? getPlanFromStripePriceId(env, stripeSubscriptionPriceId(subscription)) : "free";
  const planKey = pricePlan === "free" ? normalizePlanKey(metadata.plan_key) : pricePlan;
  const customerId = stripeId(subscription?.customer) ?? stripeId(object.customer);
  await upsertBillingAccount(env, {
    discordUserId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planKey,
    planStatus: subscription?.status || "active",
    currentPeriodStart: subscription ? stripeSubscriptionPeriodStart(subscription) : null,
    currentPeriodEnd: subscription ? stripeSubscriptionPeriodEnd(subscription) : null,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
  });
  await syncServerSubscriptionsForOwner(env, discordUserId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: subscription ? stripeSubscriptionPriceId(subscription) : null,
    planKey,
    status: subscription?.status || "active",
    currentPeriodStart: subscription ? stripeSubscriptionPeriodStart(subscription) : null,
    currentPeriodEnd: subscription ? stripeSubscriptionPeriodEnd(subscription) : null,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
  });
}

async function handleSubscriptionLikeEvent(env: Env, object: Record<string, unknown>, eventType: string) {
  const subscription = subscriptionFromEventObject(object);
  if (!subscription) {
    if (eventType === "invoice.payment_succeeded" || eventType === "invoice.payment_failed") {
      await handleInvoiceEvent(env, object, eventType);
    }
    return;
  }
  const customerId = stripeId(subscription.customer);
  const subscriptionId = subscription.id;
  const account = await findBillingAccountByCustomerOrSubscription(env, { customerId, subscriptionId });
  const metadata = metadataRecord((object as { metadata?: unknown }).metadata);
  const discordUserId = metadata.discord_user_id || stringOrNull(account?.discord_user_id);
  if (!discordUserId) return;
  const pricePlan = getPlanFromStripePriceId(env, stripeSubscriptionPriceId(subscription));
  const metadataPlan = normalizePlanKey(metadata.plan_key);
  const planKey = pricePlan === "free" ? metadataPlan : pricePlan;
  const status = eventType === "customer.subscription.deleted" ? "canceled" : subscription.status || "unknown";
  await upsertBillingAccount(env, {
    discordUserId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planKey,
    planStatus: status,
    currentPeriodStart: stripeSubscriptionPeriodStart(subscription),
    currentPeriodEnd: stripeSubscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
  await syncServerSubscriptionsForOwner(env, discordUserId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: stripeSubscriptionPriceId(subscription),
    planKey,
    status,
    currentPeriodStart: stripeSubscriptionPeriodStart(subscription),
    currentPeriodEnd: stripeSubscriptionPeriodEnd(subscription),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
}

async function handleInvoiceEvent(env: Env, object: Record<string, unknown>, eventType: string) {
  const customerId = stripeId(object.customer);
  const subscriptionId = stripeId(object.subscription) ?? nestedInvoiceSubscriptionId(object);
  const account = await findBillingAccountByCustomerOrSubscription(env, { customerId, subscriptionId });
  const discordUserId = stringOrNull(account?.discord_user_id);
  if (!discordUserId) return;

  const nextStatus = eventType === "invoice.payment_failed" ? "past_due" : stringOrNull(account?.plan_status) ?? "active";
  await upsertBillingAccount(env, {
    discordUserId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planKey: normalizePlanKey(account?.plan_key),
    planStatus: nextStatus,
    currentPeriodStart: stringOrNull(account?.current_period_start),
    currentPeriodEnd: stringOrNull(account?.current_period_end),
    cancelAtPeriodEnd: Number(account?.cancel_at_period_end ?? 0) === 1,
  });
  await syncServerSubscriptionsForOwner(env, discordUserId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: null,
    planKey: normalizePlanKey(account?.plan_key),
    status: nextStatus,
    currentPeriodStart: stringOrNull(account?.current_period_start),
    currentPeriodEnd: stringOrNull(account?.current_period_end),
    cancelAtPeriodEnd: Number(account?.cancel_at_period_end ?? 0) === 1,
  });
}

function subscriptionFromEventObject(object: Record<string, unknown>): StripeSubscription | null {
  if (typeof object.id === "string" && object.object === "subscription") {
    return object as StripeSubscription;
  }
  const subscription = object.subscription;
  if (subscription && typeof subscription === "object" && "id" in subscription) {
    return subscription as StripeSubscription;
  }
  return null;
}

async function resolveSubscription(env: Env, object: Record<string, unknown>): Promise<StripeSubscription | null> {
  const expanded = subscriptionFromEventObject(object);
  if (expanded) return expanded;
  const subscriptionId = stripeId(object.subscription);
  if (!subscriptionId) return null;
  return retrieveStripeSubscription(env, subscriptionId).catch((error) => {
    console.warn("DZN Stripe subscription retrieval skipped", error instanceof Error ? error.message : "unknown error");
    return null;
  });
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
  const details = (parent as { subscription_details?: unknown }).subscription_details;
  if (!details || typeof details !== "object") return null;
  return stripeId((details as { subscription?: unknown }).subscription);
}
