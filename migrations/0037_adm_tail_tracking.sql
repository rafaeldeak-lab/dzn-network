ALTER TABLE adm_sync_file_state ADD COLUMN file_timestamp TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN latest_known_line_count INTEGER DEFAULT 0;
ALTER TABLE adm_sync_file_state ADD COLUMN imported_line_count INTEGER DEFAULT 0;
ALTER TABLE adm_sync_file_state ADD COLUMN cursor_line INTEGER DEFAULT 0;
ALTER TABLE adm_sync_file_state ADD COLUMN last_seen_at TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN last_read_at TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN last_growth_at TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN completed_at TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN closed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_tail_status
ON adm_sync_file_state(linked_server_id, source_service_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_tail_growth
ON adm_sync_file_state(linked_server_id, source_service_id, adm_file, last_growth_at);
