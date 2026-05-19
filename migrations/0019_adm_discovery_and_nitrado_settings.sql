ALTER TABLE server_sync_state ADD COLUMN last_adm_discovery_check_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN next_adm_discovery_due_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_successful_adm_discovery_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_failed_adm_discovery_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_adm_discovery_error TEXT;
ALTER TABLE server_sync_state ADD COLUMN adm_discovery_status TEXT;
ALTER TABLE server_sync_state ADD COLUMN nitrado_reduce_log_output_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE server_sync_state ADD COLUMN nitrado_log_playerlist_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE server_sync_state ADD COLUMN nitrado_log_settings_confirmed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_discovery_due ON server_sync_state(next_adm_discovery_due_at);
