ALTER TABLE server_posting_state ADD COLUMN last_dispatch_attempt_at TEXT;
ALTER TABLE server_posting_state ADD COLUMN last_dispatch_status TEXT;
ALTER TABLE server_posting_state ADD COLUMN last_dispatch_error TEXT;
