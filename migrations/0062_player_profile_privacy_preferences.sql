CREATE TABLE IF NOT EXISTS player_profile_privacy_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  public_profile_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_profile_enabled IN (0, 1)),
  show_display_name INTEGER NOT NULL DEFAULT 1 CHECK (show_display_name IN (0, 1)),
  show_gameplay_summary INTEGER NOT NULL DEFAULT 1 CHECK (show_gameplay_summary IN (0, 1)),
  show_featured_server INTEGER NOT NULL DEFAULT 1 CHECK (show_featured_server IN (0, 1)),
  show_xp_progress INTEGER NOT NULL DEFAULT 1 CHECK (show_xp_progress IN (0, 1)),
  show_challenge_progress INTEGER NOT NULL DEFAULT 1 CHECK (show_challenge_progress IN (0, 1)),
  show_calling_cards INTEGER NOT NULL DEFAULT 1 CHECK (show_calling_cards IN (0, 1)),
  show_award_dates INTEGER NOT NULL DEFAULT 0 CHECK (show_award_dates IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_profile_privacy_preferences_user
ON player_profile_privacy_preferences(user_id);
