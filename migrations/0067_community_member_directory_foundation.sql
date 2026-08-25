-- Public-safe community member directory foundation.
-- This additive bridge is read by public presentation surfaces only.
-- It must not be used for scoring, approvals, owner decisions, billing, XP,
-- calling-card awards, rankings, reviews, seasons, or competitive eligibility.

CREATE TABLE IF NOT EXISTS community_members (
  id TEXT PRIMARY KEY,
  community_guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_label TEXT,
  display_order INTEGER DEFAULT 0,
  public_member_enabled INTEGER NOT NULL DEFAULT 1 CHECK(public_member_enabled IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'trusted_dzn_bridge',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(community_guild_id, user_id),
  FOREIGN KEY(community_guild_id) REFERENCES discord_guilds(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_guild_id
  ON community_members(community_guild_id);

CREATE INDEX IF NOT EXISTS idx_community_members_user_id
  ON community_members(user_id);

CREATE INDEX IF NOT EXISTS idx_community_members_public
  ON community_members(community_guild_id, public_member_enabled, display_order, created_at);
