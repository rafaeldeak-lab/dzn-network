CREATE TABLE IF NOT EXISTS adm_import_jobs (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  source_service_id TEXT,
  filename TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual_file_upload',
  status TEXT NOT NULL DEFAULT 'queued',
  adm_text TEXT NOT NULL,
  total_lines INTEGER DEFAULT 0,
  current_line INTEGER DEFAULT 0,
  chunk_size INTEGER DEFAULT 25,
  total_chunks INTEGER DEFAULT 1,
  chunks_processed INTEGER DEFAULT 0,
  parsed_kills INTEGER DEFAULT 0,
  written_kills INTEGER DEFAULT 0,
  duplicate_skips INTEGER DEFAULT 0,
  joins INTEGER DEFAULT 0,
  disconnects INTEGER DEFAULT 0,
  playerlist_snapshots INTEGER DEFAULT 0,
  deaths INTEGER DEFAULT 0,
  suicides INTEGER DEFAULT 0,
  uncredited_deaths INTEGER DEFAULT 0,
  hit_lines INTEGER DEFAULT 0,
  raw_events INTEGER DEFAULT 0,
  player_events INTEGER DEFAULT 0,
  failed_writes INTEGER DEFAULT 0,
  public_cache_updated INTEGER DEFAULT 0,
  discord_jobs_queued INTEGER DEFAULT 0,
  warnings_json TEXT,
  error_message TEXT,
  result_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_adm_import_jobs_server
  ON adm_import_jobs(server_id, created_at);

CREATE INDEX IF NOT EXISTS idx_adm_import_jobs_status
  ON adm_import_jobs(status, updated_at);
