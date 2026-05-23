ALTER TABLE adm_sync_file_state ADD COLUMN next_retry_at TEXT;

CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_retry
ON adm_sync_file_state(status, next_retry_at);
