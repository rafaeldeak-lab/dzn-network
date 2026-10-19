-- Inactive, server-authoritative Night Run route-control consumables.
-- Apply only after 0104 and 0105 are verified. Production feature activation is separate.
ALTER TABLE dzn_night_run_sessions ADD COLUMN decoy_armed INTEGER NOT NULL DEFAULT 0
  CHECK (decoy_armed IN (0, 1));
ALTER TABLE dzn_night_run_sessions ADD COLUMN decoy_used INTEGER NOT NULL DEFAULT 0
  CHECK (decoy_used IN (0, 1));
ALTER TABLE dzn_night_run_sessions ADD COLUMN burst_used INTEGER NOT NULL DEFAULT 0
  CHECK (burst_used IN (0, 1));
ALTER TABLE dzn_night_run_sessions ADD COLUMN gate_extension_ms INTEGER NOT NULL DEFAULT 0
  CHECK (gate_extension_ms IN (0, 900));

CREATE INDEX IF NOT EXISTS idx_dzn_night_run_route_control
  ON dzn_night_run_sessions(user_id, id, version, status);
