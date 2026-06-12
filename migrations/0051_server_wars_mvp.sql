CREATE TABLE IF NOT EXISTS server_war_events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL,
  category TEXT,
  eligible_categories TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scoring_ruleset_key TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_by_user_id TEXT,
  created_by_server_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  package_required TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_server_war_events_status_dates
ON server_war_events(status, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_server_war_events_category_status
ON server_war_events(category, status);

CREATE INDEX IF NOT EXISTS idx_server_war_events_visibility_status
ON server_war_events(visibility, status);

CREATE TABLE IF NOT EXISTS server_war_participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  owner_user_id TEXT,
  category_at_entry TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  joined_at TEXT,
  accepted_at TEXT,
  declined_at TEXT,
  final_rank INTEGER,
  final_score REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES server_war_events(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_war_participants_event_server
ON server_war_participants(event_id, server_id);

CREATE INDEX IF NOT EXISTS idx_server_war_participants_server_status
ON server_war_participants(server_id, status);

CREATE INDEX IF NOT EXISTS idx_server_war_participants_event_status
ON server_war_participants(event_id, status);

CREATE TABLE IF NOT EXISTS server_war_challenges (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  challenger_server_id TEXT NOT NULL,
  opponent_server_id TEXT NOT NULL,
  challenger_owner_user_id TEXT,
  opponent_owner_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  declined_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES server_war_events(id)
);

CREATE INDEX IF NOT EXISTS idx_server_war_challenges_opponent_status
ON server_war_challenges(opponent_server_id, status);

CREATE INDEX IF NOT EXISTS idx_server_war_challenges_challenger_status
ON server_war_challenges(challenger_server_id, status);

CREATE INDEX IF NOT EXISTS idx_server_war_challenges_event_status
ON server_war_challenges(event_id, status);

CREATE INDEX IF NOT EXISTS idx_server_war_challenges_status_expires
ON server_war_challenges(status, expires_at);

CREATE TABLE IF NOT EXISTS server_war_score_snapshots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER,
  metric_breakdown TEXT NOT NULL,
  contributor_summary TEXT NOT NULL,
  data_window_start TEXT NOT NULL,
  data_window_end TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES server_war_events(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_war_snapshots_event_snapshot
ON server_war_score_snapshots(event_id, snapshot_at);

CREATE INDEX IF NOT EXISTS idx_server_war_snapshots_event_server
ON server_war_score_snapshots(event_id, server_id, snapshot_at);

CREATE INDEX IF NOT EXISTS idx_server_war_snapshots_event_rank
ON server_war_score_snapshots(event_id, rank);

CREATE TABLE IF NOT EXISTS server_war_results (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  final_rank INTEGER NOT NULL,
  final_score REAL NOT NULL DEFAULT 0,
  metric_breakdown TEXT NOT NULL,
  top_contributors TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES server_war_events(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_war_results_event_server
ON server_war_results(event_id, server_id);

CREATE INDEX IF NOT EXISTS idx_server_war_results_event_rank
ON server_war_results(event_id, final_rank);

CREATE TABLE IF NOT EXISTS server_trophies (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  event_id TEXT,
  trophy_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  reward_type TEXT NOT NULL DEFAULT 'permanent',
  awarded_at TEXT NOT NULL,
  expires_at TEXT,
  is_current_title INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_trophies_unique_award
ON server_trophies(server_id, event_id, trophy_key);

CREATE INDEX IF NOT EXISTS idx_server_trophies_server_category_current
ON server_trophies(server_id, category, is_current_title);

CREATE INDEX IF NOT EXISTS idx_server_trophies_event
ON server_trophies(event_id);

CREATE TABLE IF NOT EXISTS server_champion_titles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title_key TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  awarded_at TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(event_id) REFERENCES server_war_events(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_champion_titles_event_title
ON server_champion_titles(event_id, title_key);

CREATE INDEX IF NOT EXISTS idx_server_champion_titles_server_active_category
ON server_champion_titles(server_id, active, category);

CREATE INDEX IF NOT EXISTS idx_server_champion_titles_active_category
ON server_champion_titles(active, category);
