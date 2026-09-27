CREATE TABLE IF NOT EXISTS player_game_identity_owner_notification_deliveries (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  recipient_discord_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
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
  FOREIGN KEY(claim_id) REFERENCES player_game_identity_claims(id) ON DELETE CASCADE,
  FOREIGN KEY(recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_link_owner_notification_claim_recipient
ON player_game_identity_owner_notification_deliveries(claim_id, recipient_user_id);

CREATE INDEX IF NOT EXISTS idx_player_link_owner_notification_due
ON player_game_identity_owner_notification_deliveries(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_player_link_owner_notification_server
ON player_game_identity_owner_notification_deliveries(linked_server_id, created_at);
