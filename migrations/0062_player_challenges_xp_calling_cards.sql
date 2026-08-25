-- Challenges / XP / Calling Cards foundation.
-- Additive only: does not alter owner billing, ADM ingestion, rankings,
-- discovery scoring, reviews, badges, seasons, events, Server Wars scoring,
-- competitive eligibility, player_profiles, kill_events, or player_events.

CREATE TABLE IF NOT EXISTS player_calling_cards (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rarity TEXT NOT NULL DEFAULT 'earned',
  source_type TEXT NOT NULL DEFAULT 'challenge',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS player_challenges (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'community',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'retired')),
  reward_xp INTEGER NOT NULL DEFAULT 0 CHECK(reward_xp >= 0),
  calling_card_code TEXT,
  target_value INTEGER NOT NULL DEFAULT 1 CHECK(target_value >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(calling_card_code) REFERENCES player_calling_cards(code)
);

CREATE TABLE IF NOT EXISTS player_challenge_participations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'joined' CHECK(status IN ('joined', 'completed', 'abandoned')),
  progress_value INTEGER NOT NULL DEFAULT 0 CHECK(progress_value >= 0),
  target_value INTEGER NOT NULL DEFAULT 1 CHECK(target_value >= 1),
  xp_awarded INTEGER NOT NULL DEFAULT 0 CHECK(xp_awarded >= 0),
  calling_card_awarded TEXT,
  joined_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, challenge_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(challenge_id) REFERENCES player_challenges(id),
  FOREIGN KEY(calling_card_awarded) REFERENCES player_calling_cards(code)
);

CREATE TABLE IF NOT EXISTS player_xp_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  xp_amount INTEGER NOT NULL CHECK(xp_amount >= 0),
  reason TEXT,
  awarded_at TEXT NOT NULL,
  UNIQUE(user_id, source_type, source_id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS player_calling_card_awards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  calling_card_code TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  UNIQUE(user_id, calling_card_code),
  UNIQUE(user_id, source_type, source_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(calling_card_code) REFERENCES player_calling_cards(code)
);

CREATE INDEX IF NOT EXISTS idx_player_challenges_status_sort
  ON player_challenges(status, sort_order);

CREATE INDEX IF NOT EXISTS idx_player_challenge_participations_user
  ON player_challenge_participations(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_player_challenge_participations_challenge
  ON player_challenge_participations(challenge_id, status);

CREATE INDEX IF NOT EXISTS idx_player_xp_ledger_user_awarded
  ON player_xp_ledger(user_id, awarded_at);

CREATE INDEX IF NOT EXISTS idx_player_xp_ledger_source
  ON player_xp_ledger(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_player_calling_card_awards_user
  ON player_calling_card_awards(user_id, awarded_at);

INSERT INTO player_calling_cards (code, name, description, rarity, source_type)
VALUES
  ('survivor_spark', 'Survivor Spark', 'Joined the first DZN player challenge track.', 'foundation', 'challenge'),
  ('community_scout', 'Community Scout', 'Started exploring DZN-connected communities.', 'foundation', 'challenge'),
  ('arena_rookie', 'Arena Rookie', 'Entered the player-side combat challenge queue.', 'foundation', 'challenge')
ON CONFLICT(code) DO NOTHING;

INSERT INTO player_challenges (
  id, slug, title, description, category, status, reward_xp, calling_card_code, target_value, sort_order
)
VALUES
  (
    'foundation-survivor-spark',
    'survivor-spark',
    'Survivor Spark',
    'Join the foundation survival track. Verified gameplay progress can award XP and the Survivor Spark calling card once challenge rules are connected.',
    'survival',
    'active',
    50,
    'survivor_spark',
    1,
    10
  ),
  (
    'foundation-community-scout',
    'community-scout',
    'Community Scout',
    'Follow the player discovery path across DZN communities. This is a player preference/progression track, not a discovery boost.',
    'community',
    'active',
    75,
    'community_scout',
    1,
    20
  ),
  (
    'foundation-arena-rookie',
    'arena-rookie',
    'Arena Rookie',
    'Enter the player challenge lane for combat-focused progress. Server Wars scores, rankings, and event outcomes stay untouched.',
    'combat',
    'active',
    100,
    'arena_rookie',
    1,
    30
  )
ON CONFLICT(slug) DO NOTHING;
