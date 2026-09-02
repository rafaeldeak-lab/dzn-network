CREATE TABLE IF NOT EXISTS player_game_identity_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  player_profile_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(player_profile_id) REFERENCES player_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS player_game_identity_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  player_profile_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  verified_source TEXT NOT NULL CHECK (verified_source IN ('owner_approved', 'dzn_admin_approved')),
  verified_by_user_id TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(player_profile_id) REFERENCES player_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(verified_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS player_game_identity_audit_log (
  id TEXT PRIMARY KEY,
  claim_id TEXT,
  link_id TEXT,
  user_id TEXT NOT NULL,
  actor_user_id TEXT,
  linked_server_id TEXT NOT NULL,
  player_profile_id TEXT,
  player_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('claim_requested', 'claim_approved', 'claim_rejected', 'claim_cancelled', 'link_created', 'link_revoked')),
  result TEXT NOT NULL CHECK (result IN ('accepted', 'denied', 'already_linked', 'conflict', 'not_found')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(claim_id) REFERENCES player_game_identity_claims(id) ON DELETE SET NULL,
  FOREIGN KEY(link_id) REFERENCES player_game_identity_links(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(player_profile_id) REFERENCES player_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_player_game_identity_claims_user_status
ON player_game_identity_claims(user_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_player_game_identity_claims_server_status
ON player_game_identity_claims(linked_server_id, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_player_game_identity_claims_profile_status
ON player_game_identity_claims(player_profile_id, status, requested_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_identity_claims_pending_user_profile
ON player_game_identity_claims(user_id, player_profile_id)
WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_identity_claims_pending_profile
ON player_game_identity_claims(player_profile_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_player_game_identity_links_user_status
ON player_game_identity_links(user_id, status, verified_at);

CREATE INDEX IF NOT EXISTS idx_player_game_identity_links_discord_active
ON player_game_identity_links(discord_id, status, verified_at);

CREATE INDEX IF NOT EXISTS idx_player_game_identity_links_server_player
ON player_game_identity_links(linked_server_id, player_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_identity_links_active_profile
ON player_game_identity_links(player_profile_id)
WHERE status = 'active' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_identity_links_active_server_player
ON player_game_identity_links(linked_server_id, player_id)
WHERE status = 'active' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_player_game_identity_audit_log_user
ON player_game_identity_audit_log(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_player_game_identity_audit_log_server
ON player_game_identity_audit_log(linked_server_id, created_at);
