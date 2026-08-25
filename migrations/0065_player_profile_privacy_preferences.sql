-- Player profile privacy preferences.
-- Additive only: does not alter owner billing, rankings, discovery scoring,
-- reviews, badges, seasons, events, Server Wars scoring, XP/calling-card awards,
-- server ownership, competitive eligibility, player_profiles, kill_events, or player_events.

CREATE TABLE IF NOT EXISTS player_profile_privacy_preferences (
  user_id TEXT PRIMARY KEY,
  public_profile_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_profile_enabled IN (0, 1)),
  show_xp INTEGER NOT NULL DEFAULT 1 CHECK(show_xp IN (0, 1)),
  show_challenge_progress INTEGER NOT NULL DEFAULT 1 CHECK(show_challenge_progress IN (0, 1)),
  show_calling_cards INTEGER NOT NULL DEFAULT 1 CHECK(show_calling_cards IN (0, 1)),
  show_award_dates INTEGER NOT NULL DEFAULT 0 CHECK(show_award_dates IN (0, 1)),
  show_discord_identity INTEGER NOT NULL DEFAULT 0 CHECK(show_discord_identity IN (0, 1)),
  show_source_details INTEGER NOT NULL DEFAULT 0 CHECK(show_source_details IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_player_profile_privacy_preferences_updated_at
  ON player_profile_privacy_preferences(updated_at);
