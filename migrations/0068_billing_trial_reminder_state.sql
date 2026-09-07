-- Private reminder projection only. Production apply requires separate approval.
CREATE TABLE billing_trial_reminder_state (
  stripe_mode TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  discord_user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  trial_end INTEGER CHECK (trial_end IS NULL OR (typeof(trial_end) = 'integer' AND trial_end > 0 AND trial_end <= 253402300799)),
  billing_revision INTEGER NOT NULL CHECK (billing_revision > 0),
  verified_at TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (stripe_mode, discord_user_id),
  FOREIGN KEY (stripe_mode, event_id) REFERENCES billing_webhook_receipts(stripe_mode, event_id)
);
