ALTER TABLE server_sync_state ADD COLUMN last_seen_adm_timestamp TEXT;
ALTER TABLE server_sync_state ADD COLUMN newest_available_adm_filename TEXT;
ALTER TABLE server_sync_state ADD COLUMN newest_available_adm_timestamp TEXT;
ALTER TABLE server_sync_state ADD COLUMN newest_readable_adm_filename TEXT;
ALTER TABLE server_sync_state ADD COLUMN newest_readable_adm_timestamp TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_processed_adm_line INTEGER;
ALTER TABLE server_sync_state ADD COLUMN last_restart_detected_source TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_restart_detected_at TEXT;
