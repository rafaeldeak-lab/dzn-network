CREATE TABLE IF NOT EXISTS discord_oauth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_discord_oauth_tokens_user_id ON discord_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_oauth_tokens_expires_at ON discord_oauth_tokens(expires_at);

ALTER TABLE linked_servers ADD COLUMN display_name TEXT;
ALTER TABLE linked_servers ADD COLUMN hostname TEXT;
ALTER TABLE linked_servers ADD COLUMN description TEXT;
ALTER TABLE linked_servers ADD COLUMN max_players INTEGER;
ALTER TABLE linked_servers ADD COLUMN current_players INTEGER;
ALTER TABLE linked_servers ADD COLUMN game_port INTEGER;
ALTER TABLE linked_servers ADD COLUMN query_port INTEGER;
ALTER TABLE linked_servers ADD COLUMN map_name TEXT;
ALTER TABLE linked_servers ADD COLUMN mission TEXT;
ALTER TABLE linked_servers ADD COLUMN server_status TEXT;
ALTER TABLE linked_servers ADD COLUMN is_online INTEGER DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN server_mode TEXT;
ALTER TABLE linked_servers ADD COLUMN server_mode_source TEXT;
ALTER TABLE linked_servers ADD COLUMN metadata_hash TEXT;
ALTER TABLE linked_servers ADD COLUMN metadata_last_checked_at TEXT;
ALTER TABLE linked_servers ADD COLUMN metadata_last_changed_at TEXT;
ALTER TABLE linked_servers ADD COLUMN raw_metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_linked_servers_nitrado_service_id ON linked_servers(nitrado_service_id);
CREATE INDEX IF NOT EXISTS idx_linked_servers_server_mode ON linked_servers(server_mode);
CREATE INDEX IF NOT EXISTS idx_linked_servers_metadata_last_checked_at ON linked_servers(metadata_last_checked_at);

CREATE TABLE IF NOT EXISTS server_metadata_versions (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  metadata_hash TEXT,
  changes_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_metadata_versions_linked_server_id ON server_metadata_versions(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_server_metadata_versions_created_at ON server_metadata_versions(created_at);
