-- Inactive DZN Signal Hunt state and bounded daily reward ledger.
-- Production application and DZN_GAMES_HIDE_SEEK_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_hide_seek_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  target_ids_json TEXT NOT NULL CHECK (json_valid(target_ids_json) AND json_type(target_ids_json) = 'array'),
  found_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(found_ids_json) AND json_type(found_ids_json) = 'array'),
  misses INTEGER NOT NULL DEFAULT 0 CHECK (misses BETWEEN 0 AND 6),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 10),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_hide_seek_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 60),
  parts INTEGER NOT NULL CHECK (parts = 2),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_hide_seek_rewards_history
  ON dzn_hide_seek_reward_ledger(user_id, created_at DESC);
