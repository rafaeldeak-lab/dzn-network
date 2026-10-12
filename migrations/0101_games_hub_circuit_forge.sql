-- Inactive, server-verified Circuit Forge relay sessions and bounded daily rewards.
-- Production application and DZN_GAMES_CIRCUIT_FORGE_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_circuit_forge_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  rotations_json TEXT NOT NULL CHECK (json_valid(rotations_json) AND json_type(rotations_json) = 'array'),
  rotations INTEGER NOT NULL DEFAULT 0 CHECK (rotations BETWEEN 0 AND 64),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 64),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_circuit_forge_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL CHECK (xp = 140),
  parts INTEGER NOT NULL CHECK (parts = 7),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_circuit_forge_rewards_history
  ON dzn_circuit_forge_reward_ledger(user_id, created_at DESC);
