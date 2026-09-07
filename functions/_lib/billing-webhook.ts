import { serverSubscriptionStatements } from "./automation";
import { requireDb } from "./db";
import { isBillingTrialRemindersEnabled } from "./feature-flags";
import { trialReminderStateStatement } from "./billing-trial-reminders";
import { billingAccountStatement, getPlanFromStripePriceId,
  normalizePlanKey, ownerEntitlementsStatement, starterTrialClaimStatement } from "./plans";
import { retrieveStripeSubscription, stripeId, stripeSubscriptionPeriodEnd, stripeSubscriptionPeriodStart,
  stripeSubscriptionPriceId, type StripeEvent } from "./stripe";
import type { Env } from "./types";

const supported = new Set(["checkout.session.completed", "invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);
const accountColumns = "discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_status, current_period_start, current_period_end, cancel_at_period_end, updated_at";
const accountSelector = "stripe_customer_id = ? OR stripe_subscription_id = ? OR discord_user_id = ?";
const guildQuery = `SELECT DISTINCT linked_servers.guild_id FROM linked_servers JOIN users ON users.id = linked_servers.user_id
  WHERE users.discord_id = ? AND linked_servers.guild_id IS NOT NULL AND linked_servers.guild_id != ''
  AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '') ORDER BY linked_servers.guild_id`;
type Account = { discord_user_id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null;
  plan_key: string; plan_status: string; current_period_start: string | null; current_period_end: string | null;
  cancel_at_period_end: number; updated_at: string };

// Stripe retries failures. Do not acknowledge an event until the whole projection is committed.
export async function reconcileBillingWebhook(env: Env, event: StripeEvent) {
  if (!supported.has(event.type)) return;
  const mode = env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "test" : null;
  if (!mode || typeof event.livemode !== "boolean" || event.livemode !== (mode === "live") || !/^evt_[A-Za-z0-9_]+$/.test(event.id ?? "")) throw new Error("Invalid event identity");
  const object = event.data?.object;
  if (!object || typeof object !== "object") throw new Error("Invalid event object");
  const checkout = event.type === "checkout.session.completed";
  const invoice = event.type.startsWith("invoice.");
  if (checkout && (object.mode !== "subscription" || !stripeId(object.id))) throw new Error("Invalid checkout");
  if (!checkout && !invoice && object.object !== "subscription") throw new Error("Invalid subscription event");
  const nested = invoice ? nestedInvoiceSubscriptionId(object) : null;
  const direct = stripeId(checkout || invoice ? object.subscription : object.id);
  if (direct && nested && direct !== nested) throw new Error("Conflicting invoice identity");
  const subscriptionId = direct ?? nested;
  if (invoice && !subscriptionId) return; // One-off invoices cannot alter subscription access.
  const customerId = stripeId(object.customer);
  if (!subscriptionId || !/^sub_[A-Za-z0-9_]+$/.test(subscriptionId) || !customerId || !/^cus_[A-Za-z0-9_]+$/.test(customerId)) throw new Error("Missing payment identity");
  const db = requireDb(env);
  const payloadHash = await digest(JSON.stringify(event));
  if (await duplicate()) return;
  // Read the revision BEFORE the provider read. A concurrent commit invalidates this snapshot.
  const revision = await db.prepare("SELECT version FROM billing_webhook_versions WHERE stripe_mode = ? AND stripe_customer_id = ?")
    .bind(mode, customerId).first<{ version: number }>();
  const subscription = await retrieveStripeSubscription(env, subscriptionId);
  if (!subscription || subscription.id !== subscriptionId || stripeId(subscription.customer) !== customerId ||
      !["active", "trialing", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"].includes(subscription.status) ||
      (subscription.livemode !== undefined && subscription.livemode !== event.livemode)) throw new Error("Unverified subscription");
  if (event.type === "customer.subscription.deleted" && subscription.status !== "canceled") throw new Error("Cancellation not confirmed");
  let planKey = getPlanFromStripePriceId(env, stripeSubscriptionPriceId(subscription));
  if (planKey === "free" && ["active", "trialing"].includes(subscription.status)) throw new Error("Unknown active Price");
  const currentPeriodStart = stripeSubscriptionPeriodStart(subscription);
  const currentPeriodEnd = stripeSubscriptionPeriodEnd(subscription);
  const terminal = ["canceled", "incomplete_expired"].includes(subscription.status);
  if ((!terminal && (!currentPeriodStart || !currentPeriodEnd)) || (currentPeriodStart && currentPeriodEnd && currentPeriodStart >= currentPeriodEnd) ||
      (subscription.cancel_at_period_end !== undefined && typeof subscription.cancel_at_period_end !== "boolean")) throw new Error("Invalid billing period");
  const providerOwner = metadataString(subscription.metadata, "discord_user_id");
  const checkoutOwner = checkout ? metadataString(object.metadata, "discord_user_id") : null;
  if (checkout && (!checkoutOwner || (providerOwner && providerOwner !== checkoutOwner))) throw new Error("Conflicting checkout owner");
  const metadataOwner = providerOwner ?? checkoutOwner;
  const accounts = await db.prepare(`SELECT ${accountColumns} FROM owner_billing_accounts WHERE ${accountSelector} LIMIT 2`)
    .bind(customerId, subscriptionId, metadataOwner).all<Account>();
  if (!accounts.success || !accounts.results || accounts.results.length > 1) throw new Error("Ambiguous account");
  const account = accounts.results[0];
  if (account && ((metadataOwner && metadataOwner !== account.discord_user_id) ||
      (account.stripe_customer_id && account.stripe_customer_id !== customerId))) throw new Error("Account identity mismatch");
  const owner = account?.discord_user_id ?? metadataOwner;
  if (!owner || (!account?.stripe_subscription_id && !metadataOwner)) throw new Error("Account proof missing");
  if (invoice && !account?.stripe_subscription_id) throw new Error("Awaiting initial subscription association");
  if (planKey === "free") {
    if (account?.stripe_subscription_id !== subscriptionId) throw new Error("Unknown Price association");
    planKey = normalizePlanKey(account.plan_key);
  }
  let superseded = Boolean(account?.stripe_subscription_id && account.stripe_subscription_id !== subscriptionId);
  let replacementAttempt: string | null = null;
  if (superseded && checkout && ["canceled", "incomplete_expired"].includes(account!.plan_status) && ["active", "trialing"].includes(subscription.status)) {
    replacementAttempt = metadataString(object.metadata, "dzn_checkout_attempt_id");
    if (!replacementAttempt) throw new Error("Replacement checkout requires durable proof");
    superseded = false;
  }
  const rows = await db.prepare(`${guildQuery} LIMIT 51`).bind(owner).all<{ guild_id: string }>();
  if (!rows.success || !rows.results || rows.results.length > 50) throw new Error("Unbounded or unavailable server projection");
  const guilds = rows.results.map(row => row.guild_id);
  const accountSnapshot = account ? JSON.stringify(accountColumns.split(", ").map(column => account[column as keyof Account])) : "null";
  const guard = db.prepare(`INSERT INTO billing_webhook_receipts
    (stripe_mode, event_id, event_type, payload_hash, stripe_customer_id, stripe_subscription_id, discord_user_id, outcome, committed_at, commit_guard)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN
      COALESCE((SELECT version FROM billing_webhook_versions WHERE stripe_mode = ? AND stripe_customer_id = ?), 0) = ?
      AND (SELECT count(*) FROM owner_billing_accounts WHERE ${accountSelector}) = ?
      AND COALESCE((SELECT json_array(${accountColumns}) FROM owner_billing_accounts WHERE ${accountSelector} LIMIT 1), 'null') = ?
      AND (SELECT json_group_array(guild_id) FROM (${guildQuery})) = ?
      AND NOT EXISTS (SELECT 1 FROM server_subscriptions WHERE guild_id IN (SELECT value FROM json_each(?)) AND owner_discord_id != ?)
      AND NOT EXISTS (SELECT 1 FROM linked_servers ls JOIN users u ON u.id = ls.user_id
        WHERE ls.guild_id IN (SELECT value FROM json_each(?)) AND u.discord_id != ?
        AND lower(COALESCE(ls.status, 'pending')) NOT IN ('deleted', 'merged') AND COALESCE(ls.merged_into_server_id, '') = '')
      AND (? IS NULL OR EXISTS (SELECT 1 FROM billing_checkout_attempts WHERE id = ? AND discord_user_id = ? AND state != 'closed'
        AND plan_key = ? AND stripe_mode = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)
        AND (stripe_session_id IS NULL OR stripe_session_id = ?)
        AND json_extract(params_json, '$."line_items[0][price]"') = ?))
      THEN 1 ELSE 0 END)`)
    .bind(mode, event.id, event.type, payloadHash, customerId, subscriptionId, owner, superseded ? "superseded" : "applied", new Date().toISOString(),
      mode, customerId, revision?.version ?? 0, customerId, subscriptionId, metadataOwner, account ? 1 : 0,
      customerId, subscriptionId, metadataOwner, accountSnapshot, owner, JSON.stringify(guilds), JSON.stringify(guilds), owner, JSON.stringify(guilds), owner,
      replacementAttempt, replacementAttempt, owner, planKey, mode, customerId, stripeId(object.id), stripeSubscriptionPriceId(subscription));
  const statements = [guard, db.prepare(`INSERT INTO billing_webhook_versions (stripe_mode, stripe_customer_id, version) VALUES (?, ?, 1)
    ON CONFLICT(stripe_mode, stripe_customer_id) DO UPDATE SET version = billing_webhook_versions.version + 1`).bind(mode, customerId)];
  if (!superseded) {
    const values = { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, planKey, status: subscription.status,
      currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end) };
    if (planKey === "starter") {
      statements.push(starterTrialClaimStatement(env, { discordUserId: owner, ...values, checkoutSessionId: checkout ? stripeId(object.id) : null }));
    }
    statements.push(billingAccountStatement(env, { discordUserId: owner, ...values, planStatus: subscription.status }),
      ownerEntitlementsStatement(env, owner, planKey, subscription.status));
    for (const guildId of guilds) statements.push(...serverSubscriptionStatements(env, {
      guildId, ownerDiscordId: owner, ...values, stripePriceId: stripeSubscriptionPriceId(subscription), forceDue: ["active", "trialing"].includes(subscription.status),
    }));
    if (isBillingTrialRemindersEnabled(env)) {
      statements.push(trialReminderStateStatement(env, { mode, owner, customerId, subscription,
        planKey, revision: (revision?.version ?? 0) + 1, eventId: event.id }));
    }
  }
  try {
    await db.batch(statements);
  } catch (error) {
    // Includes a lost batch response after COMMIT and a concurrent identical delivery.
    if (await duplicate()) return;
    throw error;
  }

  async function duplicate() {
    const receipt = await db.prepare("SELECT payload_hash FROM billing_webhook_receipts WHERE stripe_mode = ? AND event_id = ?")
      .bind(mode, event.id).first<{ payload_hash: string }>();
    if (receipt && receipt.payload_hash !== payloadHash) throw new Error("Conflicting event identity");
    return Boolean(receipt);
  }
}

function metadataString(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" && text ? text : null;
}
function nestedInvoiceSubscriptionId(object: Record<string, unknown>) {
  const parent = object.parent as { type?: string; subscription_details?: { subscription?: unknown } } | null;
  return parent?.type === "subscription_details" ? stripeId(parent.subscription_details?.subscription) : null;
}
async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
