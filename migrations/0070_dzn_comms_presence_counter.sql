-- DZN Comms live presence counter foundation.
-- Stores only short-lived hashed session presence for aggregate counts.

CREATE TABLE IF NOT EXISTS dzn_comms_presence_sessions (
  presence_key_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('site', 'community', 'global_chat')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_presence_sessions_scope_expires
  ON dzn_comms_presence_sessions (scope, expires_at);
