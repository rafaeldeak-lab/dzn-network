-- Community member import usability polish.
-- Stores trusted Discord/guild snapshot rows that can enrich private owner/admin
-- import previews without changing public profile visibility or scoring systems.

CREATE TABLE IF NOT EXISTS community_member_source_snapshots (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  community_guild_id TEXT NOT NULL,
  candidate_discord_id TEXT NOT NULL,
  candidate_username TEXT,
  candidate_display_name TEXT,
  role_label TEXT,
  source TEXT NOT NULL DEFAULT 'discord_guild_snapshot' CHECK(source IN ('discord_guild_snapshot', 'trusted_guild_snapshot', 'manual_owner_upload')),
  trust_status TEXT NOT NULL DEFAULT 'trusted' CHECK(trust_status IN ('trusted', 'unverified', 'rejected')),
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(community_guild_id) REFERENCES discord_guilds(id)
);

CREATE INDEX IF NOT EXISTS idx_community_member_source_snapshots_lookup
  ON community_member_source_snapshots(community_guild_id, candidate_discord_id, trust_status, captured_at);

CREATE INDEX IF NOT EXISTS idx_community_member_source_snapshots_scope
  ON community_member_source_snapshots(linked_server_id, community_guild_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_user_notifications_community_member_importable
  ON user_notifications(user_id, type, read_at, created_at)
  WHERE type = 'community_member_candidate_importable';
