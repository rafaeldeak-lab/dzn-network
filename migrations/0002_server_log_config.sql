CREATE TABLE IF NOT EXISTS server_log_config (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT UNIQUE NOT NULL,
  adm_path TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_log_config_linked_server_id
  ON server_log_config(linked_server_id);
