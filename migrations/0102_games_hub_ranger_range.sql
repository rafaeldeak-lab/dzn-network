-- Inactive, server-verified Ranger Range sessions and bounded daily rewards.
-- Production application and DZN_GAMES_RANGER_RANGE_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_ranger_range_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  target_sequence_json TEXT NOT NULL CHECK (json_valid(target_sequence_json) AND json_type(target_sequence_json) = 'array'),
  shot_index INTEGER NOT NULL DEFAULT 0 CHECK (shot_index BETWEEN 0 AND 8),
  misses INTEGER NOT NULL DEFAULT 0 CHECK (misses BETWEEN 0 AND 2),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 24),
  target_started_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_ranger_range_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 160),
  parts INTEGER NOT NULL CHECK (parts = 8),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_ranger_range_rewards_history
  ON dzn_ranger_range_reward_ledger(user_id, created_at DESC);
