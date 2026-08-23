-- Additive only: durable Starter trial abuse protection.
-- Do not rewrite or delete Stripe customers, invoices, subscriptions, billing accounts, or trial history.

CREATE TABLE IF NOT EXISTS owner_starter_trial_claims (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  checkout_session_id TEXT,
  status TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_discord_user_id
  ON owner_starter_trial_claims(discord_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_stripe_customer_id
  ON owner_starter_trial_claims(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != '';

CREATE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_stripe_subscription_id
  ON owner_starter_trial_claims(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_checkout_session_id
  ON owner_starter_trial_claims(checkout_session_id);
