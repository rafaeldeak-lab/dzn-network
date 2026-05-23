-- Additive diagnostics for Nitrado ADM file-read failures.
-- Do not remove, reset, or rewrite historical ADM/player telemetry rows.

CREATE TABLE IF NOT EXISTS nitrado_file_read_attempts (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  service_id TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT,
  method TEXT NOT NULL,
  endpoint_kind TEXT NOT NULL,
  attempt_number INTEGER DEFAULT 1,
  status TEXT NOT NULL,
  http_status INTEGER,
  http_status_text TEXT,
  error_code TEXT,
  error_message TEXT,
  response_excerpt TEXT,
  response_headers_json TEXT,
  duration_ms INTEGER,
  request_url_redacted TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_service_id
  ON nitrado_file_read_attempts(service_id);

CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_server_id
  ON nitrado_file_read_attempts(server_id);

CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_file_name
  ON nitrado_file_read_attempts(file_name);

CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_status
  ON nitrado_file_read_attempts(status);

CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_http_status
  ON nitrado_file_read_attempts(http_status);

CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_created_at
  ON nitrado_file_read_attempts(created_at);

ALTER TABLE adm_sync_file_state ADD COLUMN last_http_status INTEGER;
ALTER TABLE adm_sync_file_state ADD COLUMN last_http_status_text TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN last_endpoint_kind TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN last_method TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN last_response_excerpt TEXT;
ALTER TABLE adm_sync_file_state ADD COLUMN last_diagnostic_at TEXT;
