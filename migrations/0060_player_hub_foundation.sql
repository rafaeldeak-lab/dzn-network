-- Player Hub foundation.
-- Additive only: does not alter owner billing, ADM ingestion, rankings, player_profiles,
-- kill_events, player_events, competitive scoring, or existing subscriptions.

CREATE TABLE IF NOT EXISTS player_saved_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, linked_server_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_player_saved_servers_user_id
  ON player_saved_servers(user_id);

CREATE INDEX IF NOT EXISTS idx_player_saved_servers_linked_server_id
  ON player_saved_servers(linked_server_id);

CREATE INDEX IF NOT EXISTS idx_player_saved_servers_updated_at
  ON player_saved_servers(updated_at);
