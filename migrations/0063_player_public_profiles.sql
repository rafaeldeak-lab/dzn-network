CREATE TABLE IF NOT EXISTS player_public_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (length(handle) >= 3 AND length(handle) <= 48),
  CHECK (handle = lower(handle)),
  CHECK (handle NOT LIKE '-%' AND handle NOT LIKE '%-'),
  CHECK (handle NOT LIKE '%--%'),
  CHECK (handle NOT GLOB '*[^a-z0-9-]*')
);

CREATE INDEX IF NOT EXISTS idx_player_public_profiles_handle
ON player_public_profiles(handle);

CREATE INDEX IF NOT EXISTS idx_player_public_profiles_user_status
ON player_public_profiles(user_id, status);
