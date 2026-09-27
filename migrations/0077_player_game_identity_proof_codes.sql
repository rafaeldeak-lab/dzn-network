CREATE TABLE IF NOT EXISTS player_game_identity_proof_codes (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  issued_by_user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  consumed_by_user_id TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(claim_id) REFERENCES player_game_identity_claims(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE,
  FOREIGN KEY(issued_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(consumed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_game_identity_proof_codes_active_claim
ON player_game_identity_proof_codes(claim_id)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_player_game_identity_proof_codes_claim_status
ON player_game_identity_proof_codes(claim_id, status, expires_at);
