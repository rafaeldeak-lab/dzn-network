ALTER TABLE server_sync_state ADD COLUMN first_adm_after_restart_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN first_adm_after_restart_delay_minutes INTEGER;
ALTER TABLE server_sync_state ADD COLUMN first_useful_adm_line_after_restart_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN observed_playerlist_interval_minutes INTEGER;
ALTER TABLE server_sync_state ADD COLUMN observed_adm_cadence_minutes INTEGER;
ALTER TABLE server_sync_state ADD COLUMN previous_playerlist_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_playerlist_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_useful_adm_event_at TEXT;

CREATE INDEX IF NOT EXISTS idx_server_sync_state_last_useful_adm_event ON server_sync_state(last_useful_adm_event_at);
