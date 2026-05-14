CREATE TABLE IF NOT EXISTS adm_sync_state (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL UNIQUE,
  latest_adm_file TEXT,
  latest_adm_path TEXT,
  last_processed_file TEXT,
  last_processed_line INTEGER DEFAULT 0,
  last_processed_offset INTEGER DEFAULT 0,
  last_sync_status TEXT DEFAULT 'not_started',
  last_sync_message TEXT,
  last_sync_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS adm_raw_events (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  adm_file TEXT,
  line_number INTEGER,
  raw_line TEXT NOT NULL,
  event_type TEXT,
  parsed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS player_profiles (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_id TEXT,
  discord_id TEXT,
  kills INTEGER DEFAULT 0,
  deaths INTEGER DEFAULT 0,
  suicides INTEGER DEFAULT 0,
  longest_kill_distance REAL DEFAULT 0,
  last_seen_at TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS player_events (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  player_profile_id TEXT,
  player_name TEXT,
  player_id TEXT,
  event_type TEXT NOT NULL,
  position_x REAL,
  position_y REAL,
  position_z REAL,
  adm_file TEXT,
  line_number INTEGER,
  occurred_at TEXT,
  raw_line TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(player_profile_id) REFERENCES player_profiles(id)
);

CREATE TABLE IF NOT EXISTS kill_events (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  killer_profile_id TEXT,
  victim_profile_id TEXT,
  killer_name TEXT,
  victim_name TEXT,
  killer_id TEXT,
  victim_id TEXT,
  weapon TEXT,
  distance REAL,
  position_x REAL,
  position_y REAL,
  position_z REAL,
  adm_file TEXT,
  line_number INTEGER,
  occurred_at TEXT,
  raw_line TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(killer_profile_id) REFERENCES player_profiles(id),
  FOREIGN KEY(victim_profile_id) REFERENCES player_profiles(id)
);

CREATE TABLE IF NOT EXISTS server_stats (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL UNIQUE,
  total_kills INTEGER DEFAULT 0,
  total_deaths INTEGER DEFAULT 0,
  total_joins INTEGER DEFAULT 0,
  total_disconnects INTEGER DEFAULT 0,
  unique_players INTEGER DEFAULT 0,
  last_event_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_adm_sync_state_linked_server_id ON adm_sync_state(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_adm_raw_events_linked_server_id ON adm_raw_events(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_adm_raw_events_adm_file ON adm_raw_events(adm_file);
CREATE INDEX IF NOT EXISTS idx_adm_raw_events_event_type ON adm_raw_events(event_type);
CREATE INDEX IF NOT EXISTS idx_player_profiles_linked_server_id ON player_profiles(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_player_profiles_player_name ON player_profiles(player_name);
CREATE INDEX IF NOT EXISTS idx_player_profiles_player_id ON player_profiles(player_id);
CREATE INDEX IF NOT EXISTS idx_player_events_linked_server_id ON player_events(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_player_events_event_type ON player_events(event_type);
CREATE INDEX IF NOT EXISTS idx_player_events_occurred_at ON player_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_kill_events_linked_server_id ON kill_events(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_kill_events_killer_name ON kill_events(killer_name);
CREATE INDEX IF NOT EXISTS idx_kill_events_victim_name ON kill_events(victim_name);
CREATE INDEX IF NOT EXISTS idx_kill_events_occurred_at ON kill_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_server_stats_linked_server_id ON server_stats(linked_server_id);
