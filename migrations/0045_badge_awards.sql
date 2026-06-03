-- Phase 4B badge unlock, progress, and live crown state.
-- Additive only: does not alter ADM ingestion, imported stats, player_profiles, billing webhooks, or existing achievement tables.

CREATE TABLE IF NOT EXISTS server_badge_awards (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  badge_code TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  award_type TEXT NOT NULL,
  source TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_badge_awards_server
  ON server_badge_awards(server_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_server_badge_awards_code_active
  ON server_badge_awards(badge_code, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_server_badge_awards_active_unique
  ON server_badge_awards(server_id, badge_code)
  WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS badge_unlock_progress (
  server_id TEXT NOT NULL,
  badge_code TEXT NOT NULL,
  current_value REAL NOT NULL DEFAULT 0,
  target_value REAL NOT NULL DEFAULT 0,
  progress_percent REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, badge_code)
);

CREATE INDEX IF NOT EXISTS idx_badge_unlock_progress_badge
  ON badge_unlock_progress(badge_code, progress_percent);

CREATE TABLE IF NOT EXISTS crown_holders (
  crown_code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  score_snapshot REAL NOT NULL DEFAULT 0,
  previous_server_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_crown_holders_server
  ON crown_holders(server_id);
