-- Isolated player Command Centre progression. Production application and
-- DZN_COMMAND_CENTRE_ENABLED activation are separate controlled operations.
CREATE TABLE dzn_command_centre_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dzn_command_centre_buildings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building TEXT NOT NULL CHECK (building IN ('headquarters', 'workshop', 'watchtower', 'communications')),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  target_level INTEGER CHECK (target_level BETWEEN 2 AND 5),
  construction_started_at INTEGER,
  completes_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (user_id, building),
  CHECK (
    (target_level IS NULL AND construction_started_at IS NULL AND completes_at IS NULL)
    OR (
      target_level = level + 1
      AND construction_started_at IS NOT NULL
      AND completes_at IS NOT NULL
      AND completes_at > construction_started_at
    )
  )
);

CREATE TABLE dzn_command_centre_spend_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  building TEXT NOT NULL CHECK (building IN ('headquarters', 'workshop', 'watchtower', 'communications')),
  from_level INTEGER NOT NULL CHECK (from_level BETWEEN 1 AND 4),
  to_level INTEGER NOT NULL CHECK (to_level = from_level + 1),
  parts_spent INTEGER NOT NULL CHECK (parts_spent > 0),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
);

CREATE INDEX idx_dzn_command_centre_buildings_state
  ON dzn_command_centre_buildings(user_id, completes_at);
CREATE INDEX idx_dzn_command_centre_spend_history
  ON dzn_command_centre_spend_ledger(user_id, created_at DESC);
