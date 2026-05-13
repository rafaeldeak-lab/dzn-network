CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discord_guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  icon_url TEXT,
  permissions TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (guild_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS linked_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  guild_id TEXT NOT NULL,
  discord_guild_id INTEGER NOT NULL,
  nitrado_service_id TEXT NOT NULL,
  nitrado_service_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  server_type TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  region TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  public_slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (discord_guild_id) REFERENCES discord_guilds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nitrado_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  linked_server_id INTEGER,
  encrypted_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS onboarding_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linked_server_id INTEGER NOT NULL UNIQUE,
  token_valid INTEGER NOT NULL DEFAULT 0,
  service_access INTEGER NOT NULL DEFAULT 0,
  adm_logs_found INTEGER NOT NULL DEFAULT 0,
  dayz_service_detected INTEGER NOT NULL DEFAULT 0,
  last_tested_at TEXT,
  FOREIGN KEY (linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_discord_guilds_owner ON discord_guilds(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_linked_servers_user ON linked_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_nitrado_connections_user ON nitrado_connections(user_id);
