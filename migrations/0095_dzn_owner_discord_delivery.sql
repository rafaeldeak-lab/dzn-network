-- Private central-Discord delivery attempts for already approved DZN owners.
-- Apply this additive migration independently after 0094. It records delivery
-- state only; it neither creates an invite nor changes a Discord role itself.

CREATE TABLE IF NOT EXISTS dzn_owner_discord_access_delivery_attempts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  requester_user_id TEXT,
  requester_discord_id TEXT,
  actor_user_id TEXT,
  actor_discord_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('diagnostic', 'invite', 'role_grant', 'role_revoke')),
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'not_joined', 'retryable_failure', 'failed', 'not_configured')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  delivery_nonce TEXT NOT NULL,
  guild_id TEXT,
  invite_channel_id TEXT,
  role_id TEXT,
  discord_http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(request_id) REFERENCES dzn_owner_discord_access_requests(id) ON DELETE CASCADE,
  FOREIGN KEY(requester_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dzn_owner_discord_delivery_nonce
  ON dzn_owner_discord_access_delivery_attempts(delivery_nonce);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_delivery_request
  ON dzn_owner_discord_access_delivery_attempts(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_delivery_request_operation
  ON dzn_owner_discord_access_delivery_attempts(request_id, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_delivery_requester
  ON dzn_owner_discord_access_delivery_attempts(requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_delivery_actor
  ON dzn_owner_discord_access_delivery_attempts(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_owner_discord_delivery_status
  ON dzn_owner_discord_access_delivery_attempts(status, created_at DESC);
