-- Authoritative progression awards foundation.
-- Additive only: records trusted, verified activity facts for player progression.
-- Does not alter owner billing, rankings, discovery scoring, reviews, badges,
-- seasons, events, Server Wars scoring, competitive eligibility, player_profiles,
-- kill_events, or player_events.

CREATE TABLE IF NOT EXISTS player_progression_award_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN (
    'adm_gameplay',
    'challenge_rule',
    'community_activity',
    'event_participation',
    'verified_activity'
  )),
  source_id TEXT NOT NULL,
  progress_value INTEGER NOT NULL DEFAULT 1 CHECK(progress_value >= 0),
  verification_status TEXT NOT NULL DEFAULT 'verified' CHECK(verification_status IN ('verified', 'rejected')),
  verified_at TEXT NOT NULL,
  evidence_json TEXT,
  processed_at TEXT,
  result_status TEXT NOT NULL DEFAULT 'pending' CHECK(result_status IN (
    'pending',
    'progressed',
    'awarded',
    'duplicate',
    'skipped',
    'failed'
  )),
  result_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source_type, source_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(challenge_id) REFERENCES player_challenges(id)
);

CREATE INDEX IF NOT EXISTS idx_player_progression_award_sources_pending
  ON player_progression_award_sources(verification_status, result_status, verified_at);

CREATE INDEX IF NOT EXISTS idx_player_progression_award_sources_user
  ON player_progression_award_sources(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_player_progression_award_sources_challenge
  ON player_progression_award_sources(challenge_id, result_status);
