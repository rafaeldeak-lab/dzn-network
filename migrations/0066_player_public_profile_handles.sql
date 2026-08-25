ALTER TABLE player_profile_privacy_preferences ADD COLUMN public_handle TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_profile_privacy_public_handle
  ON player_profile_privacy_preferences(public_handle)
  WHERE public_handle IS NOT NULL;
