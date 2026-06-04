-- Phase 6F: lightweight promotion analytics.
-- No personal data is stored; events are aggregated by server, promotion, source, and timestamp only.

CREATE TABLE IF NOT EXISTS promotion_impressions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  promotion_id TEXT,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_impressions_server_time
  ON promotion_impressions(server_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_promotion_impressions_promotion_time
  ON promotion_impressions(promotion_id, occurred_at);

CREATE TABLE IF NOT EXISTS promotion_clicks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  promotion_id TEXT,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_clicks_server_time
  ON promotion_clicks(server_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_promotion_clicks_promotion_time
  ON promotion_clicks(promotion_id, occurred_at);
