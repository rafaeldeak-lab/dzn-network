-- Additive private billing receipts. Production application requires separate approval.
CREATE TABLE billing_webhook_versions (
  stripe_mode TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  stripe_customer_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  PRIMARY KEY (stripe_mode, stripe_customer_id)
);

CREATE TABLE billing_webhook_receipts (
  stripe_mode TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'superseded')),
  committed_at TEXT NOT NULL,
  commit_guard INTEGER NOT NULL CHECK (commit_guard = 1),
  PRIMARY KEY (stripe_mode, event_id)
);
CREATE INDEX idx_billing_webhook_receipts_owner_time ON billing_webhook_receipts(discord_user_id, committed_at);
