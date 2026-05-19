ALTER TABLE adm_sync_state ADD COLUMN last_processed_adm_line_hash TEXT;
ALTER TABLE adm_sync_state ADD COLUMN last_processed_adm_line_text_preview TEXT;
ALTER TABLE adm_sync_state ADD COLUMN last_cursor_validation_status TEXT;
ALTER TABLE adm_sync_state ADD COLUMN last_cursor_validation_error TEXT;
ALTER TABLE adm_sync_state ADD COLUMN last_cursor_validation_at TEXT;
ALTER TABLE adm_sync_state ADD COLUMN cursor_recovery_strategy TEXT;
ALTER TABLE adm_sync_state ADD COLUMN cursor_recovery_reason TEXT;
