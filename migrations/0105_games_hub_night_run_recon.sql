-- Inactive, server-recorded Night Run jammer scans.
-- Production application and DZN_GAMES_NIGHT_RUN_RECON_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_night_run_gate_scans (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  gate_index INTEGER NOT NULL CHECK (gate_index BETWEEN 0 AND 8),
  scanned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id, gate_index)
);

CREATE INDEX IF NOT EXISTS idx_dzn_night_run_gate_scans_session
  ON dzn_night_run_gate_scans(user_id, game_id, gate_index);
