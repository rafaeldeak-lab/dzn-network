import { requireDb } from "./db";
import { isBillingRemindersEnabled } from "./feature-flags";
import { getBillingPlanSummaries } from "./plans";
import { canRefreshTrialReminders, trialEndingNoticeStatement } from "./billing-trial-reminders";
import type { Env, SessionUser } from "./types";

export const PAYMENT_SETUP_NOTIFICATION_TYPE = "billing_payment_setup";
export const PAYMENT_SETUP_DEDUPE_KEY = "billing-payment-setup-v1";

// First-time owner setup only. Existing, ambiguous or in-progress billing needs its own recovery flow.
const eligibleOwnerSql = `SELECT 1 FROM users AS reminder_owner
  WHERE reminder_owner.id = ? AND reminder_owner.discord_id = ?
    AND EXISTS (SELECT 1 FROM linked_servers AS reminder_server
      WHERE reminder_server.user_id = reminder_owner.id
        AND lower(COALESCE(reminder_server.status, 'pending')) NOT IN ('deleted', 'merged')
        AND COALESCE(reminder_server.merged_into_server_id, '') = ''
        AND length(trim(COALESCE(reminder_server.nitrado_service_id, ''))) > 0)
    AND NOT EXISTS (SELECT 1 FROM owner_billing_accounts WHERE discord_user_id = reminder_owner.discord_id)
    AND NOT EXISTS (SELECT 1 FROM owner_starter_trial_claims WHERE discord_user_id = reminder_owner.discord_id)
    AND NOT EXISTS (SELECT 1 FROM owner_plan_entitlements
      WHERE discord_user_id = reminder_owner.discord_id AND lower(COALESCE(plan_key, 'unknown')) != 'free')
    AND NOT EXISTS (SELECT 1 FROM billing_checkout_attempts
      WHERE discord_user_id = reminder_owner.discord_id AND state != 'closed')
    AND NOT EXISTS (SELECT 1 FROM server_subscriptions
      WHERE (server_subscriptions.owner_discord_id = reminder_owner.discord_id
        OR EXISTS (SELECT 1 FROM linked_servers AS paid_server
          WHERE paid_server.guild_id = server_subscriptions.guild_id AND paid_server.user_id = reminder_owner.id))
        AND (lower(COALESCE(server_subscriptions.plan_key, 'unknown')) != 'free'
          OR lower(COALESCE(server_subscriptions.status, 'unknown')) NOT IN ('free', 'inactive', 'canceled', 'incomplete_expired')))`;

export function paymentSetupNoticeCopy(env: Env) {
  const available = getBillingPlanSummaries(env).some((plan) => plan.plan_key === "starter" && plan.checkout_enabled);
  return {
    title: "Please set up payment",
    body: available
      ? "Starter includes a two-day trial, then GBP 2/month. Review the terms and enter your card details in Stripe. This reminder does not start a trial or charge you."
      : "Starter payment setup is temporarily unavailable while billing checks are completed. Your trial has not started. Review the owner plans for the current checkout status.",
    action_url: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
    metadata: { checkout_available: available },
  };
}

export async function canShowPaymentSetupNotice(env: Env, user: SessionUser) {
  if (!isBillingRemindersEnabled(env)) return false;
  // Missing prerequisite schema suppresses the optional reminder without changing or migrating billing.
  return Boolean(await requireDb(env).prepare(eligibleOwnerSql).bind(user.id, user.discord_id).first().catch(() => null));
}

export async function refreshPaymentSetupNotice(env: Env, user: SessionUser) {
  if (!isBillingRemindersEnabled(env)) return;
  const copy = paymentSetupNoticeCopy(env);
  const db = requireDb(env);
  const statements = [db.prepare(`INSERT OR IGNORE INTO user_notifications
    (id, user_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at)
    SELECT ?, ?, ?, ?, ?, ?, 100, ?, '{}', CURRENT_TIMESTAMP
    WHERE EXISTS (${eligibleOwnerSql})`)
    .bind(crypto.randomUUID(), user.id, PAYMENT_SETUP_NOTIFICATION_TYPE, copy.title, copy.body, copy.action_url,
      PAYMENT_SETUP_DEDUPE_KEY, user.id, user.discord_id)];
  if (canRefreshTrialReminders(env)) statements.push(trialEndingNoticeStatement(env, user));
  await db.batch(statements);
}
