CREATE TABLE IF NOT EXISTS adm_worker_selection_state (
  service_id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  last_worker_selected_at TEXT,
  next_worker_due_at TEXT,
  selected_count INTEGER DEFAULT 0,
  last_selection_reason TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adm_worker_selection_state_linked_server
  ON adm_worker_selection_state(linked_server_id);

CREATE INDEX IF NOT EXISTS idx_adm_worker_selection_state_selected
  ON adm_worker_selection_state(last_worker_selected_at);
