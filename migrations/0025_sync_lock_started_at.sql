ALTER TABLE server_sync_state ADD COLUMN status_sync_started_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN adm_sync_started_at TEXT;

UPDATE server_sync_state
SET status_sync_started_at = COALESCE(status_sync_started_at, last_status_check_at, updated_at)
WHERE COALESCE(currently_checking_status, 0) = 1
  AND status_sync_started_at IS NULL;

UPDATE server_sync_state
SET adm_sync_started_at = COALESCE(adm_sync_started_at, last_adm_pull_at, updated_at)
WHERE COALESCE(currently_syncing_adm, 0) = 1
  AND adm_sync_started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_started
ON server_sync_state(status_sync_started_at);

CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_started
ON server_sync_state(adm_sync_started_at);
