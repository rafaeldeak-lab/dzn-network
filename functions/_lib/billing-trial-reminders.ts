import { requireDb } from "./db";
import { isBillingRemindersEnabled, isBillingTrialRemindersEnabled } from "./feature-flags";
import type { StripeSubscription } from "./stripe";
import type { Env, SessionUser } from "./types";

export const TRIAL_ENDING_NOTIFICATION_TYPE = "billing_trial_ending";
const dedupePrefix = "billing-trial-ending-v1:";
type Trial = { stripe_mode: string; stripe_subscription_id: string; trial_end: number };

// Called only inside the verified webhook's guarded transaction; never from a player request.
export function trialReminderStateStatement(env: Env, input: {
  mode: "test" | "live"; owner: string; customerId: string; subscription: StripeSubscription;
  planKey: string; revision: number; eventId: string;
}) {
  const s = input.subscription;
  const end = s.trial_end;
  const trustworthy = input.planKey === "starter" && s.status === "trialing" &&
    s.livemode === (input.mode === "live") && s.cancel_at_period_end === false &&
    s.cancel_at == null && s.pause_collection == null &&
    typeof end === "number" && Number.isSafeInteger(end) && end > 0 && end <= 253402300799;
  return requireDb(env).prepare(`INSERT INTO billing_trial_reminder_state
    (stripe_mode, discord_user_id, stripe_customer_id, stripe_subscription_id, trial_end, billing_revision, verified_at, event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_mode, discord_user_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
      trial_end = excluded.trial_end, billing_revision = excluded.billing_revision,
      verified_at = excluded.verified_at, event_id = excluded.event_id`)
    .bind(input.mode, input.owner, input.customerId, s.id, trustworthy ? end : null,
      input.revision, new Date().toISOString(), input.eventId);
}

const dueTrialSql = `SELECT trial.stripe_mode, trial.stripe_subscription_id, trial.trial_end
  FROM billing_trial_reminder_state AS trial
  JOIN users ON users.discord_id = trial.discord_user_id
  JOIN owner_billing_accounts AS account ON account.discord_user_id = trial.discord_user_id
  JOIN billing_webhook_versions AS revision ON revision.stripe_mode = trial.stripe_mode
    AND revision.stripe_customer_id = trial.stripe_customer_id
  WHERE users.id = ? AND users.discord_id = ? AND trial.stripe_mode = ?
    AND account.stripe_customer_id = trial.stripe_customer_id
    AND account.stripe_subscription_id = trial.stripe_subscription_id
    AND lower(account.plan_key) = 'starter' AND account.plan_status = 'trialing'
    AND account.cancel_at_period_end = 0 AND revision.version = trial.billing_revision
    AND trial.trial_end > unixepoch('now') AND trial.trial_end <= unixepoch('now') + 86400
    AND NOT EXISTS (SELECT 1 FROM owner_billing_accounts AS other
      WHERE other.discord_user_id != trial.discord_user_id
        AND (other.stripe_customer_id = trial.stripe_customer_id OR other.stripe_subscription_id = trial.stripe_subscription_id))`;

function stripeMode(env: Env) {
  return env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "test" : "unavailable";
}

export function canRefreshTrialReminders(env: Env) {
  return isBillingRemindersEnabled(env) && isBillingTrialRemindersEnabled(env);
}

export async function currentTrialEndingNotice(env: Env, user: SessionUser) {
  if (!canRefreshTrialReminders(env)) return null;
  const trial = await requireDb(env).prepare(dueTrialSql).bind(user.id, user.discord_id, stripeMode(env)).first<Trial>().catch(() => null);
  if (!trial) return null;
  const end = new Date(trial.trial_end * 1000).toISOString();
  const deadline = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(end));
  return {
    dedupeKey: `${dedupePrefix}${trial.stripe_mode}:${trial.stripe_subscription_id}:${trial.trial_end}`,
    copy: {
      title: "Your Starter trial ends within one day",
      body: `Your trial ends on ${deadline} UTC. Review your Starter billing and cancellation options in your dashboard before it ends.`,
      action_url: "/dashboard",
      metadata: { trial_ends_at: end },
    },
  };
}

export function trialEndingNoticeStatement(env: Env, user: SessionUser) {
  return requireDb(env).prepare(`INSERT OR IGNORE INTO user_notifications
    (id, user_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at, expires_at)
    SELECT ?, ?, ?, 'Starter trial ending', 'Review your billing.', '/dashboard', 110,
      ? || stripe_mode || ':' || stripe_subscription_id || ':' || trial_end, '{}', CURRENT_TIMESTAMP, datetime(trial_end, 'unixepoch')
    FROM (${dueTrialSql})`)
    .bind(crypto.randomUUID(), user.id, TRIAL_ENDING_NOTIFICATION_TYPE, dedupePrefix, user.id, user.discord_id, stripeMode(env));
}
