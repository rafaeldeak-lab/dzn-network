-- Inactive, server-verified Relay Rush state and bounded daily rewards.
-- Production application and DZN_GAMES_RELAY_RUSH_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_relay_rush_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  route_json TEXT NOT NULL CHECK (json_valid(route_json) AND json_type(route_json) = 'array'),
  current_index INTEGER NOT NULL DEFAULT 0 CHECK (current_index BETWEEN 0 AND 12),
  misses INTEGER NOT NULL DEFAULT 0 CHECK (misses BETWEEN 0 AND 3),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 12),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_relay_rush_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 90),
  parts INTEGER NOT NULL CHECK (parts = 3),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_relay_rush_rewards_history
  ON dzn_relay_rush_reward_ledger(user_id, created_at DESC);
