-- Player-owned, public-profile showcase preferences for existing Store supporter cards.
-- This is additive: it neither grants, changes, nor revokes any Store entitlement.

CREATE TABLE IF NOT EXISTS player_cabinet_showcase_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  publicly_showcased INTEGER NOT NULL DEFAULT 0 CHECK (publicly_showcased IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, entitlement_key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_cabinet_showcase_user_public
ON player_cabinet_showcase_items(user_id, publicly_showcased, updated_at DESC);
