-- Inactive, server-verified Signal Shift sessions and bounded daily rewards.
-- Production application and DZN_GAMES_SIGNAL_SHIFT_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_signal_shift_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  tiles_json TEXT NOT NULL CHECK (json_valid(tiles_json) AND json_type(tiles_json) = 'array'),
  moves INTEGER NOT NULL DEFAULT 0 CHECK (moves BETWEEN 0 AND 72),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 96),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_signal_shift_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 130),
  parts INTEGER NOT NULL CHECK (parts = 6),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_signal_shift_rewards_history
  ON dzn_signal_shift_reward_ledger(user_id, created_at DESC);
