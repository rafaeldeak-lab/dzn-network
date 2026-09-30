CREATE TABLE IF NOT EXISTS server_community_members (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_label TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  public_member_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_member_enabled IN (0, 1)),
  member_approved_at TEXT,
  source TEXT NOT NULL DEFAULT 'owner_public_handle' CHECK (source = 'owner_public_handle'),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(linked_server_id, user_id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_server_community_members_public
ON server_community_members(linked_server_id, public_member_enabled, display_order, created_at);

CREATE INDEX IF NOT EXISTS idx_server_community_members_user_updated
ON server_community_members(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS server_community_member_audit (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  member_user_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('add', 'update', 'remove', 'approve', 'revoke')),
  role_label TEXT,
  public_member_enabled INTEGER CHECK (public_member_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(member_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_server_community_member_audit_server
ON server_community_member_audit(linked_server_id, created_at DESC);
