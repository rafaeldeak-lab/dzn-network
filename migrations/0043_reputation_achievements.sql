-- Phase 1 DZN reputation network framework.
-- Additive only: does not modify ADM ingestion, player_profiles, kills, deaths, events, or subscriptions.

CREATE TABLE IF NOT EXISTS server_achievement_awards (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  achievement_key TEXT NOT NULL,
  achievement_category TEXT NOT NULL,
  achievement_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  source_event_id TEXT,
  season_key TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  permanent INTEGER NOT NULL DEFAULT 1,
  awarded_at TEXT NOT NULL,
  expires_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_achievement_awards_unique
  ON server_achievement_awards(linked_server_id, achievement_key, COALESCE(season_key, ''));
CREATE INDEX IF NOT EXISTS idx_server_achievement_awards_server
  ON server_achievement_awards(linked_server_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_server_achievement_awards_category
  ON server_achievement_awards(achievement_category);

CREATE TABLE IF NOT EXISTS server_crown_holders (
  crown_key TEXT PRIMARY KEY,
  crown_name TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  server_category TEXT,
  score REAL NOT NULL DEFAULT 0,
  awarded_at TEXT NOT NULL,
  previous_holder_linked_server_id TEXT,
  last_evaluated_at TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_crown_holders_server
  ON server_crown_holders(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_server_crown_holders_category
  ON server_crown_holders(server_category);

CREATE TABLE IF NOT EXISTS server_seasonal_rewards (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  season_key TEXT NOT NULL,
  season_name TEXT NOT NULL,
  reward_key TEXT NOT NULL,
  reward_name TEXT NOT NULL,
  placement INTEGER,
  points REAL NOT NULL DEFAULT 0,
  permanent INTEGER NOT NULL DEFAULT 1,
  awarded_at TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_seasonal_rewards_unique
  ON server_seasonal_rewards(linked_server_id, season_key, reward_key);
CREATE INDEX IF NOT EXISTS idx_server_seasonal_rewards_season
  ON server_seasonal_rewards(season_key, placement);

CREATE TABLE IF NOT EXISTS server_reputation_snapshots (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  reputation_score INTEGER NOT NULL DEFAULT 0,
  reputation_tier TEXT NOT NULL DEFAULT 'Bronze',
  visibility_weight INTEGER NOT NULL DEFAULT 0,
  plan_key TEXT,
  achievement_count INTEGER NOT NULL DEFAULT 0,
  crown_count INTEGER NOT NULL DEFAULT 0,
  seasonal_reward_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'system',
  calculated_at TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_reputation_snapshots_server
  ON server_reputation_snapshots(linked_server_id, calculated_at);
CREATE INDEX IF NOT EXISTS idx_server_reputation_snapshots_tier
  ON server_reputation_snapshots(reputation_tier);
