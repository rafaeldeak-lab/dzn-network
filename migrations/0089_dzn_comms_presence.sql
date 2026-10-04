-- Privacy-preserving aggregate presence for DZN Comms.
-- Stores only a keyed actor digest and short-lived timestamps. No raw account,
-- Discord, network, route, device, billing, gameplay, or location data is stored.

CREATE TABLE IF NOT EXISTS dzn_comms_presence_sessions (
  actor_key_hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('global_chat')),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(actor_key_hash, scope)
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_presence_scope_expiry
  ON dzn_comms_presence_sessions(scope, expires_at);
