-- Inactive DZN Trivia game state and reward ledger.
-- Production application and DZN_GAMES_TRIVIA_ENABLED activation are separate operations.
CREATE TABLE IF NOT EXISTS dzn_trivia_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('recruit', 'operator', 'specialist')),
  question_ids_json TEXT NOT NULL CHECK (
    json_valid(question_ids_json) AND json_type(question_ids_json) = 'array'
  ),
  current_index INTEGER NOT NULL DEFAULT 0 CHECK (current_index BETWEEN 0 AND 5),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'passed', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 5),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dzn_trivia_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reward_key TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('recruit', 'operator', 'specialist')),
  game_id TEXT NOT NULL UNIQUE,
  xp INTEGER NOT NULL,
  parts INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, reward_key),
  CHECK (
    (difficulty = 'recruit' AND xp = 40 AND parts = 1) OR
    (difficulty = 'operator' AND xp = 80 AND parts = 2) OR
    (difficulty = 'specialist' AND xp = 120 AND parts = 3)
  )
);

CREATE INDEX IF NOT EXISTS idx_dzn_trivia_rewards_history
  ON dzn_trivia_reward_ledger(user_id, created_at DESC);
