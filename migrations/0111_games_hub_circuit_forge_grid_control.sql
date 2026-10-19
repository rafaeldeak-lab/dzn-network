-- Inactive, one-use Circuit Forge diagnostic and phase-control state.
-- Apply this migration and verify it independently before enabling
-- DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED.
ALTER TABLE dzn_circuit_forge_sessions ADD COLUMN diagnostic_used INTEGER NOT NULL DEFAULT 0
  CHECK (diagnostic_used IN (0, 1));
ALTER TABLE dzn_circuit_forge_sessions ADD COLUMN phase_used INTEGER NOT NULL DEFAULT 0
  CHECK (phase_used IN (0, 1));
ALTER TABLE dzn_circuit_forge_sessions ADD COLUMN diagnostic_index INTEGER
  CHECK (diagnostic_index IS NULL OR (diagnostic_index BETWEEN 0 AND 24 AND diagnostic_index <> 12));

CREATE INDEX idx_dzn_circuit_forge_grid_control
  ON dzn_circuit_forge_sessions(user_id, id, version, status);
