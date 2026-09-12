-- Private subscription-checkout recovery only. Production apply is separately approved.
CREATE TABLE billing_checkout_attempts (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  plan_key TEXT NOT NULL CHECK (plan_key IN ('starter', 'pro')),
  stripe_customer_id TEXT,
  stripe_mode TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  stripe_key_fingerprint TEXT NOT NULL,
  stripe_api_version TEXT NOT NULL,
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'request_started', 'session_ready', 'closed')),
  first_requested_at INTEGER,
  stripe_session_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_billing_checkout_attempts_pending_owner
  ON billing_checkout_attempts(discord_user_id) WHERE state != 'closed';
CREATE INDEX idx_billing_checkout_attempts_owner_created
  ON billing_checkout_attempts(discord_user_id, created_at);

CREATE TRIGGER billing_checkout_attempts_immutable_request
BEFORE UPDATE ON billing_checkout_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.discord_user_id IS NOT OLD.discord_user_id
  OR NEW.plan_key IS NOT OLD.plan_key OR NEW.stripe_customer_id IS NOT OLD.stripe_customer_id
  OR NEW.stripe_mode IS NOT OLD.stripe_mode OR NEW.stripe_key_fingerprint IS NOT OLD.stripe_key_fingerprint
  OR NEW.stripe_api_version IS NOT OLD.stripe_api_version OR NEW.params_json IS NOT OLD.params_json
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.first_requested_at IS NOT NULL AND NEW.first_requested_at IS NOT OLD.first_requested_at)
  OR (OLD.stripe_session_id IS NOT NULL AND NEW.stripe_session_id IS NOT OLD.stripe_session_id)
  OR (OLD.state = 'closed' AND NEW.state != 'closed')
BEGIN
  SELECT RAISE(ABORT, 'Checkout request identity is immutable');
END;
