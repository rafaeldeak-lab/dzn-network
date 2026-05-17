ALTER TABLE adm_sync_state ADD COLUMN last_raw_kill_lines_found INTEGER DEFAULT 0;
ALTER TABLE adm_sync_state ADD COLUMN last_parsed_kill_lines_found INTEGER DEFAULT 0;
ALTER TABLE adm_sync_state ADD COLUMN last_parser_skipped_lines INTEGER DEFAULT 0;
ALTER TABLE adm_sync_state ADD COLUMN last_unreadable_files_queued INTEGER DEFAULT 0;
ALTER TABLE adm_sync_state ADD COLUMN last_newest_unprocessed_adm_file TEXT;

CREATE TABLE IF NOT EXISTS adm_sync_file_state (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  source_service_id TEXT NOT NULL,
  adm_file TEXT NOT NULL,
  adm_path TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT,
  last_readable_at TEXT,
  processed_at TEXT,
  line_count INTEGER DEFAULT 0,
  last_line_processed INTEGER DEFAULT 0,
  raw_kill_lines_found INTEGER DEFAULT 0,
  parsed_kill_lines_found INTEGER DEFAULT 0,
  inserted_kills INTEGER DEFAULT 0,
  parser_skipped_lines INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  ignored_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_adm_sync_file_state_server_file
ON adm_sync_file_state(linked_server_id, source_service_id, adm_file);

CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_status
ON adm_sync_file_state(status);

CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_checked
ON adm_sync_file_state(last_checked_at);
