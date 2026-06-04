-- Phase 6D promotion credit foundation.
-- Additive only: does not alter ADM ingestion, imported stats, player_profiles,
-- Stripe webhooks, auth/session state, or competitive leaderboard calculations.

CREATE TABLE IF NOT EXISTS promotion_credits (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  credits_available INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_credits_server_period
  ON promotion_credits(server_id, period_start);
CREATE INDEX IF NOT EXISTS idx_promotion_credits_server
  ON promotion_credits(server_id, period_end);

CREATE TABLE IF NOT EXISTS server_promotions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  promotion_type TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_server_promotions_server_status
  ON server_promotions(server_id, status, ends_at);
CREATE INDEX IF NOT EXISTS idx_server_promotions_type_status
  ON server_promotions(promotion_type, status, ends_at);

CREATE TABLE IF NOT EXISTS promotion_audit_log (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promotion_audit_log_server
  ON promotion_audit_log(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_promotion_audit_log_action
  ON promotion_audit_log(action, created_at);
