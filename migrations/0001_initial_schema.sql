CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  username TEXT,
  avatar TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS discord_guilds (
  id TEXT PRIMARY KEY,
  guild_id TEXT UNIQUE NOT NULL,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  icon_url TEXT,
  permissions TEXT,
  is_owner INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS linked_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  discord_guild_id TEXT NOT NULL,
  nitrado_service_id TEXT,
  nitrado_service_name TEXT,
  server_name TEXT NOT NULL,
  server_type TEXT NOT NULL,
  tags_json TEXT,
  region TEXT,
  status TEXT DEFAULT 'pending',
  public_slug TEXT UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS nitrado_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS onboarding_checks (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  token_valid INTEGER DEFAULT 0,
  service_access INTEGER DEFAULT 0,
  adm_logs_found INTEGER DEFAULT 0,
  dayz_service_detected INTEGER DEFAULT 0,
  last_tested_at TEXT,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_token_hash ON sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_discord_guilds_guild_id ON discord_guilds(guild_id);
CREATE INDEX IF NOT EXISTS idx_linked_servers_user_id ON linked_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_linked_servers_discord_guild_id ON linked_servers(discord_guild_id);
CREATE INDEX IF NOT EXISTS idx_linked_servers_public_slug ON linked_servers(public_slug);
CREATE INDEX IF NOT EXISTS idx_nitrado_connections_linked_server_id ON nitrado_connections(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_checks_linked_server_id ON onboarding_checks(linked_server_id);
