CREATE TABLE IF NOT EXISTS onboarding_drafts (
  user_id TEXT PRIMARY KEY,
  current_step INTEGER NOT NULL DEFAULT 0 CHECK (current_step BETWEEN 0 AND 6),
  completion_percent INTEGER NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  discord_guild_id TEXT,
  server_type TEXT,
  server_category TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  public_short_description TEXT,
  public_description TEXT,
  public_discord_invite TEXT,
  public_website_url TEXT,
  public_rules TEXT,
  public_language TEXT,
  public_region_label TEXT,
  linked_server_id TEXT,
  nitrado_service_id TEXT,
  direct_service_validated INTEGER NOT NULL DEFAULT 0 CHECK (direct_service_validated IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_onboarding_drafts_updated
ON onboarding_drafts(updated_at);
