-- Private DZN Discord access requests for verified server owners.
-- This additive migration must be applied and verified independently. It does
-- not create Discord invites, change roles, or make any external Discord call.

CREATE TABLE IF NOT EXISTS dzn_owner_discord_access_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL,
  requester_discord_id TEXT NOT NULL,
  requester_username TEXT,
  linked_server_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  request_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  decision_reason TEXT,
  decision_nonce TEXT,
  reviewed_by_user_id TEXT,
  reviewed_by_discord_id TEXT,
  reviewed_by_username TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dzn_owner_discord_access_one_pending_or_approved
  ON dzn_owner_discord_access_requests(requester_user_id, linked_server_id)
  WHERE status IN ('pending', 'approved');
CREATE UNIQUE INDEX IF NOT EXISTS idx_dzn_owner_discord_access_decision_nonce
  ON dzn_owner_discord_access_requests(decision_nonce)
  WHERE decision_nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_access_status
  ON dzn_owner_discord_access_requests(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_access_requester
  ON dzn_owner_discord_access_requests(requester_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dzn_owner_discord_access_audit (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_discord_id TEXT,
  actor_username TEXT,
  action TEXT NOT NULL CHECK (action IN ('requested', 'approved', 'rejected', 'revoked')),
  previous_status TEXT,
  next_status TEXT NOT NULL CHECK (next_status IN ('pending', 'approved', 'rejected', 'revoked')),
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id) REFERENCES dzn_owner_discord_access_requests(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_access_audit_request
  ON dzn_owner_discord_access_audit(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_access_audit_created
  ON dzn_owner_discord_access_audit(created_at DESC);
