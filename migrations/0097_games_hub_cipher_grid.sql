-- Inactive, server-verified Cipher Grid state and bounded daily rewards.
-- Production application and DZN_GAMES_CIPHER_GRID_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_cipher_grid_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL CHECK (length(answer) = 5 AND answer = upper(answer)),
  attempts_json TEXT NOT NULL CHECK (json_valid(attempts_json) AND json_type(attempts_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 6),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_cipher_grid_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 100),
  parts INTEGER NOT NULL CHECK (parts = 4),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_cipher_grid_rewards_history
  ON dzn_cipher_grid_reward_ledger(user_id, created_at DESC);
