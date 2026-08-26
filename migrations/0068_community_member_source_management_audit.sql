-- Trusted community member source management and audit.
-- This additive owner/admin workflow can import a candidate into the
-- presentation-only community_members bridge after DZN resolves exactly one
-- existing user. It must not control player public profile opt-in, scoring,
-- approvals, billing, XP, calling-card awards, rankings, seasons, events, or
-- competitive eligibility.

CREATE TABLE IF NOT EXISTS community_member_candidates (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  community_guild_id TEXT NOT NULL,
  candidate_discord_id TEXT,
  candidate_username TEXT,
  candidate_display_name TEXT,
  role_label TEXT,
  source TEXT NOT NULL DEFAULT 'owner_import',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'imported', 'rejected', 'duplicate', 'ambiguous')),
  match_status TEXT NOT NULL DEFAULT 'pending' CHECK(match_status IN ('pending', 'matched', 'no_match', 'duplicate', 'ambiguous')),
  matched_user_id TEXT,
  imported_member_id TEXT,
  reason TEXT,
  created_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(community_guild_id) REFERENCES discord_guilds(id),
  FOREIGN KEY(matched_user_id) REFERENCES users(id),
  FOREIGN KEY(imported_member_id) REFERENCES community_members(id),
  FOREIGN KEY(created_by_user_id) REFERENCES users(id),
  FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS community_member_source_audit (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  community_member_id TEXT,
  linked_server_id TEXT NOT NULL,
  community_guild_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('owner', 'admin')),
  action TEXT NOT NULL CHECK(action IN (
    'candidate_created',
    'candidate_rejected',
    'candidate_imported',
    'candidate_no_match',
    'duplicate_rejected',
    'ambiguous_rejected'
  )),
  result_status TEXT NOT NULL CHECK(result_status IN ('accepted', 'rejected', 'skipped', 'failed')),
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES community_member_candidates(id),
  FOREIGN KEY(community_member_id) REFERENCES community_members(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(community_guild_id) REFERENCES discord_guilds(id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_community_member_candidates_scope
  ON community_member_candidates(linked_server_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_community_member_candidates_guild_candidate
  ON community_member_candidates(community_guild_id, candidate_discord_id, status);

CREATE INDEX IF NOT EXISTS idx_community_member_candidates_matched_user
  ON community_member_candidates(matched_user_id, status);

CREATE INDEX IF NOT EXISTS idx_community_member_source_audit_scope
  ON community_member_source_audit(linked_server_id, created_at);

CREATE INDEX IF NOT EXISTS idx_community_member_source_audit_candidate
  ON community_member_source_audit(candidate_id, created_at);
