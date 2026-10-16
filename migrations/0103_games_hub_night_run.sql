-- Inactive, server-verified Night Run sessions and bounded daily rewards.
-- Production application and DZN_GAMES_NIGHT_RUN_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_night_run_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  lane_sequence_json TEXT NOT NULL CHECK (json_valid(lane_sequence_json) AND json_type(lane_sequence_json) = 'array'),
  gate_index INTEGER NOT NULL DEFAULT 0 CHECK (gate_index BETWEEN 0 AND 9),
  collisions INTEGER NOT NULL DEFAULT 0 CHECK (collisions BETWEEN 0 AND 2),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 27),
  gate_started_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_night_run_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 180),
  parts INTEGER NOT NULL CHECK (parts = 9),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_night_run_rewards_history
  ON dzn_night_run_reward_ledger(user_id, created_at DESC);
