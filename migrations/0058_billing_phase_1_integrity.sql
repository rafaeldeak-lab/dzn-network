-- DZN Billing Phase 1 linked-server allowance reservation integrity.
-- Additive only: no linked servers, subscriptions, Nitrado tokens, player
-- profiles, kills, events, sessions, or historical rows are deleted or reset.

CREATE TABLE IF NOT EXISTS linked_server_allowance_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_user_id TEXT,
  linked_server_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'onboarding',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  released_at TEXT,
  expired_at TEXT,
  release_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lsar_user_status_expires
ON linked_server_allowance_reservations(user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_lsar_linked_server_status
ON linked_server_allowance_reservations(linked_server_id, status);

CREATE INDEX IF NOT EXISTS idx_lsar_discord_user_status
ON linked_server_allowance_reservations(discord_user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lsar_active_linked_server
ON linked_server_allowance_reservations(linked_server_id)
WHERE status = 'active' AND linked_server_id IS NOT NULL;
