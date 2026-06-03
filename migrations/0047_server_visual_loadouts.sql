-- Phase 5A visual loadout selections for server cards and profiles.
-- Additive only: does not alter ADM ingestion, imported stats, player_profiles, billing webhooks, or existing badge awards.

CREATE TABLE IF NOT EXISTS server_visual_loadouts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL UNIQUE,
  showcase_badges_json TEXT,
  profile_frame_key TEXT,
  theme_banner_key TEXT,
  animation_enabled INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_visual_loadouts_server
  ON server_visual_loadouts(server_id);

CREATE TABLE IF NOT EXISTS server_customisation_audit_log (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_customisation_audit_log_server
  ON server_customisation_audit_log(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_server_customisation_audit_log_action
  ON server_customisation_audit_log(action, created_at);
