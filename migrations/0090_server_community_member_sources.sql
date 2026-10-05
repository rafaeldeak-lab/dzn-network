-- Private, server-scoped candidate intake and decision audit for the public
-- community directory. Candidates never become public directly: an import
-- creates a private server_community_members row and the player must still
-- approve that separate directory invitation.

CREATE TABLE IF NOT EXISTS server_community_member_candidates (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  candidate_discord_id TEXT,
  candidate_username TEXT,
  role_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'imported', 'rejected', 'duplicate', 'no_match')),
  matched_user_id TEXT,
  imported_member_id TEXT,
  reason TEXT,
  created_by_user_id TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  decision_nonce TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(matched_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(imported_member_id) REFERENCES server_community_members(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_server_community_member_candidates_scope
ON server_community_member_candidates(linked_server_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_server_community_member_candidates_match
ON server_community_member_candidates(matched_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_community_member_candidates_one_pending
ON server_community_member_candidates(linked_server_id, matched_user_id)
WHERE status = 'pending' AND matched_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_community_member_candidates_one_pending_discord
ON server_community_member_candidates(linked_server_id, candidate_discord_id)
WHERE status = 'pending' AND candidate_discord_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS server_community_member_source_audit (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  candidate_id TEXT,
  member_user_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL
    CHECK (action IN ('candidate_created', 'candidate_imported', 'candidate_rejected', 'candidate_duplicate', 'candidate_no_match')),
  result_status TEXT NOT NULL CHECK (result_status IN ('accepted', 'rejected', 'skipped')),
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(candidate_id) REFERENCES server_community_member_candidates(id) ON DELETE SET NULL,
  FOREIGN KEY(member_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_server_community_member_source_audit_scope
ON server_community_member_source_audit(linked_server_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_server_community_member_source_audit_candidate
ON server_community_member_source_audit(candidate_id, created_at DESC);
