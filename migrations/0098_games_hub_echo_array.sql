-- Inactive, server-verified Echo Array sessions and bounded daily rewards.
-- Production application and DZN_GAMES_ECHO_ARRAY_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_echo_array_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  sequence_json TEXT NOT NULL CHECK (json_valid(sequence_json) AND json_type(sequence_json) = 'array'),
  stage INTEGER NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 3),
  input_index INTEGER NOT NULL DEFAULT 0 CHECK (input_index BETWEEN 0 AND 8),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors BETWEEN 0 AND 2),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 32),
  cue_started_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_echo_array_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 110),
  parts INTEGER NOT NULL CHECK (parts = 5),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_echo_array_rewards_history
  ON dzn_echo_array_reward_ledger(user_id, created_at DESC);
