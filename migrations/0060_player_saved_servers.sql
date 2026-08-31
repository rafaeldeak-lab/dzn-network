CREATE TABLE IF NOT EXISTS player_saved_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  UNIQUE(user_id, linked_server_id)
);

CREATE INDEX IF NOT EXISTS idx_player_saved_servers_user_created
ON player_saved_servers(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_saved_servers_linked_server
ON player_saved_servers(linked_server_id);
