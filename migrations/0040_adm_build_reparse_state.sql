CREATE TABLE IF NOT EXISTS adm_build_reparse_state (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  source_service_id TEXT NOT NULL,
  adm_file TEXT NOT NULL,
  build_parser_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  last_line_processed INTEGER DEFAULT 0,
  raw_lines_scanned INTEGER DEFAULT 0,
  build_events_found INTEGER DEFAULT 0,
  build_events_added INTEGER DEFAULT 0,
  last_build_reparse_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(linked_server_id, source_service_id, adm_file, build_parser_version)
);

CREATE INDEX IF NOT EXISTS idx_adm_build_reparse_state_status
ON adm_build_reparse_state(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_adm_build_reparse_state_file
ON adm_build_reparse_state(linked_server_id, source_service_id, adm_file);
