CREATE TABLE IF NOT EXISTS adm_worker_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
