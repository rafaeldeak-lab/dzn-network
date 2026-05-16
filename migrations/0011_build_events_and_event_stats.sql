CREATE TABLE IF NOT EXISTS build_events (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  nitrado_service_id TEXT NOT NULL,
  player_id TEXT,
  player_name TEXT,
  event_type TEXT NOT NULL,
  build_part TEXT,
  target_object TEXT,
  tool TEXT,
  placed_object TEXT,
  placed_class TEXT,
  pos_x REAL,
  pos_y REAL,
  pos_z REAL,
  source_adm_file TEXT NOT NULL,
  source_line_number INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  raw_line TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_build_events_linked_server_id
ON build_events(linked_server_id);

CREATE INDEX IF NOT EXISTS idx_build_events_nitrado_service_id
ON build_events(nitrado_service_id);

CREATE INDEX IF NOT EXISTS idx_build_events_player_id
ON build_events(player_id);

CREATE INDEX IF NOT EXISTS idx_build_events_occurred_at
ON build_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_build_events_event_type
ON build_events(event_type);

CREATE INDEX IF NOT EXISTS idx_build_events_build_part
ON build_events(build_part);

CREATE INDEX IF NOT EXISTS idx_build_events_placed_class
ON build_events(placed_class);

CREATE UNIQUE INDEX IF NOT EXISTS idx_build_events_service_file_line
ON build_events(nitrado_service_id, source_adm_file, source_line_number);

CREATE TABLE IF NOT EXISTS server_build_stats (
  linked_server_id TEXT PRIMARY KEY,
  nitrado_service_id TEXT NOT NULL,
  structures_built INTEGER NOT NULL DEFAULT 0,
  build_items_placed INTEGER NOT NULL DEFAULT 0,
  storage_items_placed INTEGER NOT NULL DEFAULT 0,
  traps_placed INTEGER NOT NULL DEFAULT 0,
  build_score INTEGER NOT NULL DEFAULT 0,
  top_builder_name TEXT,
  top_builder_count INTEGER NOT NULL DEFAULT 0,
  last_build_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_build_stats_nitrado_service_id
ON server_build_stats(nitrado_service_id);

CREATE INDEX IF NOT EXISTS idx_server_build_stats_build_score
ON server_build_stats(build_score);

CREATE INDEX IF NOT EXISTS idx_server_build_stats_last_build_at
ON server_build_stats(last_build_at);
