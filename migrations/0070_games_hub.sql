-- Isolated website-game progress. No billing, gameplay or public-profile changes.
CREATE TABLE dzn_game_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('recon', 'patrol', 'survival')),
  board_json TEXT NOT NULL CHECK (json_valid(board_json)),
  status TEXT NOT NULL CHECK (status IN ('playing', 'won', 'lost')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dzn_game_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  reward_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recon', 'patrol', 'survival', 'workshop')),
  game_id TEXT UNIQUE,
  xp INTEGER NOT NULL CHECK (xp >= 0),
  parts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key),
  CHECK ((kind = 'workshop' AND xp = 0 AND parts = -12 AND game_id IS NULL)
    OR (kind = 'recon' AND xp = 50 AND parts = 1 AND game_id IS NOT NULL)
    OR (kind = 'patrol' AND xp = 100 AND parts = 2 AND game_id IS NOT NULL)
    OR (kind = 'survival' AND xp = 150 AND parts = 3 AND game_id IS NOT NULL))
);
CREATE INDEX idx_dzn_game_rewards_history ON dzn_game_reward_ledger(user_id, created_at DESC);
