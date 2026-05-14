CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT,
  trigger_type TEXT,
  status TEXT,
  message TEXT,
  lines_read INTEGER DEFAULT 0,
  lines_processed INTEGER DEFAULT 0,
  events_created INTEGER DEFAULT 0,
  kills_created INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_linked_server_id ON sync_runs(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_created_at ON sync_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status);
