-- Additive competitive events ecosystem schema.
-- Do not remove, reset, or rewrite historical DZN telemetry rows.

ALTER TABLE linked_servers ADD COLUMN server_category TEXT;
ALTER TABLE linked_servers ADD COLUMN competitive_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN verified_server INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN event_mmr INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE linked_servers ADD COLUMN season_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN event_wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN event_losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN event_draws INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN last_event_at TEXT;

CREATE TABLE IF NOT EXISTS competitive_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',
  visibility TEXT NOT NULL DEFAULT 'public',
  premium_tier TEXT DEFAULT 'free',
  server_limit INTEGER,
  team_limit INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  created_by TEXT,
  banner_url TEXT,
  rules TEXT,
  rewards TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS competitive_event_servers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  category TEXT NOT NULL,
  approved INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  seed INTEGER,
  registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, server_id),
  FOREIGN KEY(event_id) REFERENCES competitive_events(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS competitive_event_matches (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  left_server_id TEXT NOT NULL,
  right_server_id TEXT NOT NULL,
  category TEXT NOT NULL,
  match_status TEXT DEFAULT 'pending',
  winner_server_id TEXT,
  round_number INTEGER,
  left_score INTEGER DEFAULT 0,
  right_score INTEGER DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES competitive_events(id),
  FOREIGN KEY(left_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(right_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS competitive_event_activity (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  server_id TEXT,
  activity_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES competitive_events(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS competitive_seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS competitive_season_standings (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  category TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  events_played INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, server_id),
  FOREIGN KEY(season_id) REFERENCES competitive_seasons(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_competitive_events_status ON competitive_events(status);
CREATE INDEX IF NOT EXISTS idx_competitive_events_category ON competitive_events(category);
CREATE INDEX IF NOT EXISTS idx_competitive_events_event_type ON competitive_events(event_type);
CREATE INDEX IF NOT EXISTS idx_competitive_event_servers_event_id ON competitive_event_servers(event_id);
CREATE INDEX IF NOT EXISTS idx_competitive_event_servers_server_id ON competitive_event_servers(server_id);
CREATE INDEX IF NOT EXISTS idx_competitive_event_servers_category ON competitive_event_servers(category);
CREATE INDEX IF NOT EXISTS idx_competitive_event_matches_event_id ON competitive_event_matches(event_id);
CREATE INDEX IF NOT EXISTS idx_competitive_event_matches_category ON competitive_event_matches(category);
CREATE INDEX IF NOT EXISTS idx_competitive_event_matches_status ON competitive_event_matches(match_status);
CREATE INDEX IF NOT EXISTS idx_competitive_event_activity_event_id ON competitive_event_activity(event_id);
CREATE INDEX IF NOT EXISTS idx_competitive_event_activity_created_at ON competitive_event_activity(created_at);
CREATE INDEX IF NOT EXISTS idx_competitive_season_standings_season_id ON competitive_season_standings(season_id);
CREATE INDEX IF NOT EXISTS idx_competitive_season_standings_category ON competitive_season_standings(category);
CREATE INDEX IF NOT EXISTS idx_linked_servers_server_category ON linked_servers(server_category);
CREATE INDEX IF NOT EXISTS idx_linked_servers_competitive_category ON linked_servers(competitive_enabled, server_category);
