CREATE TABLE IF NOT EXISTS adm_worker_heartbeat (
  id TEXT PRIMARY KEY,
  worker_name TEXT NOT NULL,
  last_started_at TEXT,
  last_finished_at TEXT,
  last_status TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_selected_service_id TEXT,
  last_selected_server_id TEXT,
  last_action TEXT,
  last_recoverable INTEGER DEFAULT 0,
  run_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adm_worker_heartbeat_worker_name
ON adm_worker_heartbeat(worker_name);

CREATE INDEX IF NOT EXISTS idx_adm_worker_heartbeat_updated_at
ON adm_worker_heartbeat(updated_at);
