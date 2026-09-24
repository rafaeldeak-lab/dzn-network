CREATE TABLE IF NOT EXISTS player_game_identity_notification_deliveries (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  claim_id TEXT,
  link_id TEXT,
  user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('approved', 'rejected', 'revoked')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'delivered', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_id TEXT,
  lease_expires_at TEXT,
  last_attempt_at TEXT,
  delivered_at TEXT,
  result_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(audit_id) REFERENCES player_game_identity_audit_log(id) ON DELETE CASCADE,
  FOREIGN KEY(claim_id) REFERENCES player_game_identity_claims(id) ON DELETE SET NULL,
  FOREIGN KEY(link_id) REFERENCES player_game_identity_links(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_link_notification_delivery_audit
ON player_game_identity_notification_deliveries(audit_id);

CREATE INDEX IF NOT EXISTS idx_player_link_notification_delivery_due
ON player_game_identity_notification_deliveries(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_player_link_notification_delivery_user
ON player_game_identity_notification_deliveries(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_player_link_notification_delivery_server
ON player_game_identity_notification_deliveries(linked_server_id, created_at);
