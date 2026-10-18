-- Isolated Survival Command expedition storage. Apply only after 0107 is verified.
-- DZN_SURVIVAL_COMMAND_ENABLED remains disabled until this migration is verified separately.
CREATE TABLE dzn_survival_command_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  established_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dzn_survival_command_expeditions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  sector TEXT NOT NULL CHECK (sector IN ('perimeter', 'rail_yard', 'radio_ridge', 'blacksite')),
  approach TEXT NOT NULL CHECK (approach IN ('scout', 'balanced', 'breach')),
  status TEXT NOT NULL CHECK (status IN ('deployed', 'resolved')),
  seed TEXT NOT NULL CHECK (length(seed) >= 16),
  deployment_day TEXT NOT NULL CHECK (length(deployment_day) = 10),
  deployment_cost INTEGER NOT NULL CHECK (deployment_cost BETWEEN 1 AND 3),
  started_at INTEGER NOT NULL,
  ready_at INTEGER NOT NULL CHECK (ready_at > started_at),
  resolved_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (user_id, request_id),
  CHECK ((status = 'deployed' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL))
);

CREATE TABLE dzn_survival_command_resolution_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expedition_id TEXT NOT NULL UNIQUE REFERENCES dzn_survival_command_expeditions(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('clean', 'strained', 'breakthrough')),
  salvage INTEGER NOT NULL CHECK (salvage > 0),
  intel INTEGER NOT NULL CHECK (intel > 0),
  outcome_fingerprint TEXT NOT NULL CHECK (length(outcome_fingerprint) = 8),
  resolved_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
);

CREATE UNIQUE INDEX idx_dzn_survival_command_one_active_expedition
  ON dzn_survival_command_expeditions(user_id)
  WHERE status = 'deployed';
CREATE INDEX idx_dzn_survival_command_expeditions_user_recent
  ON dzn_survival_command_expeditions(user_id, resolved_at DESC, started_at DESC);
CREATE INDEX idx_dzn_survival_command_expeditions_daily
  ON dzn_survival_command_expeditions(user_id, deployment_day, started_at DESC);
CREATE INDEX idx_dzn_survival_command_resolution_history
  ON dzn_survival_command_resolution_ledger(user_id, resolved_at DESC);
