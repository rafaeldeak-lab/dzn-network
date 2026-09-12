CREATE TABLE IF NOT EXISTS player_discord_community_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_icon TEXT,
  guild_icon_url TEXT,
  relationship TEXT NOT NULL DEFAULT 'member'
    CHECK (relationship IN ('member', 'administrator', 'owner')),
  source TEXT NOT NULL DEFAULT 'discord_oauth_guilds',
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_player_discord_community_memberships_user_active
ON player_discord_community_memberships(user_id, revoked_at, guild_name);

CREATE INDEX IF NOT EXISTS idx_player_discord_community_memberships_guild
ON player_discord_community_memberships(guild_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_player_discord_community_memberships_last_seen
ON player_discord_community_memberships(last_seen_at);
