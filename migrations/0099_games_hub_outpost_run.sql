-- Inactive, server-verified Outpost Run sessions and bounded daily rewards.
-- Production application and DZN_GAMES_OUTPOST_RUN_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_outpost_run_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  layout_json TEXT NOT NULL CHECK (json_valid(layout_json) AND json_type(layout_json) = 'object'),
  visited_json TEXT NOT NULL CHECK (json_valid(visited_json) AND json_type(visited_json) = 'array'),
  position_row INTEGER NOT NULL DEFAULT 2 CHECK (position_row BETWEEN 0 AND 4),
  position_column INTEGER NOT NULL DEFAULT 2 CHECK (position_column BETWEEN 0 AND 4),
  energy INTEGER NOT NULL DEFAULT 4 CHECK (energy BETWEEN 0 AND 4),
  moves INTEGER NOT NULL DEFAULT 0 CHECK (moves BETWEEN 0 AND 12),
  scanned INTEGER NOT NULL DEFAULT 0 CHECK (scanned IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 32),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_outpost_run_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 125),
  parts INTEGER NOT NULL CHECK (parts = 6),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_outpost_run_rewards_history
  ON dzn_outpost_run_reward_ledger(user_id, created_at DESC);
