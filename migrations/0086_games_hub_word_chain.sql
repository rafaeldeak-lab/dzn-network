-- Inactive shared DZN Word Chain state and bounded reward ledger.
-- Production application and DZN_GAMES_WORD_CHAIN_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_word_chain_rounds (
  id TEXT PRIMARY KEY,
  current_word TEXT NOT NULL CHECK (length(current_word) BETWEEN 3 AND 18),
  current_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 500),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_word_chain_entries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES dzn_word_chain_rounds(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  word TEXT NOT NULL CHECK (length(word) BETWEEN 3 AND 18 AND word = lower(word)),
  turn_number INTEGER NOT NULL CHECK (turn_number BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  UNIQUE (round_id, word),
  UNIQUE (round_id, turn_number)
);

CREATE INDEX IF NOT EXISTS idx_dzn_word_chain_entries_recent
  ON dzn_word_chain_entries(round_id, turn_number DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_word_chain_entries_player
  ON dzn_word_chain_entries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dzn_word_chain_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reward_key TEXT NOT NULL,
  round_id TEXT NOT NULL REFERENCES dzn_word_chain_rounds(id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL UNIQUE REFERENCES dzn_word_chain_entries(id) ON DELETE RESTRICT,
  xp INTEGER NOT NULL CHECK (xp = 25),
  parts INTEGER NOT NULL CHECK (parts = 1),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_dzn_word_chain_rewards_history
  ON dzn_word_chain_reward_ledger(user_id, created_at DESC);
