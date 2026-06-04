-- Phase 7A: DZN server-vs-server seasons foundation.
-- Additive only. Seasons read existing aggregate stats and store competition snapshots/results.

CREATE TABLE IF NOT EXISTS dzn_seasons (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  scoring_rules_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dzn_seasons_status_dates
  ON dzn_seasons(status, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_dzn_seasons_category
  ON dzn_seasons(category, status);

CREATE TABLE IF NOT EXISTS dzn_season_entries (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  category TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  status TEXT NOT NULL,
  snapshot_start_json TEXT,
  snapshot_current_json TEXT,
  final_score REAL,
  rank INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_dzn_season_entries_season_rank
  ON dzn_season_entries(season_id, rank);

CREATE INDEX IF NOT EXISTS idx_dzn_season_entries_server
  ON dzn_season_entries(server_id, status);

CREATE TABLE IF NOT EXISTS dzn_season_score_snapshots (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER,
  metrics_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dzn_season_score_snapshots_season
  ON dzn_season_score_snapshots(season_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_dzn_season_score_snapshots_server
  ON dzn_season_score_snapshots(server_id, captured_at);

CREATE TABLE IF NOT EXISTS dzn_season_awards (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  award_code TEXT NOT NULL,
  rank INTEGER,
  awarded_at TEXT NOT NULL,
  metadata_json TEXT,
  UNIQUE(season_id, server_id, award_code)
);

CREATE INDEX IF NOT EXISTS idx_dzn_season_awards_season
  ON dzn_season_awards(season_id, rank);

CREATE INDEX IF NOT EXISTS idx_dzn_season_awards_server
  ON dzn_season_awards(server_id, awarded_at);
