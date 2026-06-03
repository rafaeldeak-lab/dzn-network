-- Additive visual metadata for server badge, frame, and theme presentation.
-- This does not alter earned achievements, reputation snapshots, ADM data, or public stats.

CREATE TABLE IF NOT EXISTS badge_visual_definitions (
  badge_key TEXT PRIMARY KEY,
  static_icon_url TEXT,
  animated_icon_url TEXT,
  image_alt TEXT,
  rarity TEXT NOT NULL DEFAULT 'common',
  theme TEXT,
  glow_colour TEXT,
  animation_type TEXT NOT NULL DEFAULT 'none',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_showcase_badge INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1,
  display_size TEXT NOT NULL DEFAULT 'md',
  unlock_type TEXT NOT NULL DEFAULT 'earned',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_badge_visual_definitions_public_sort
  ON badge_visual_definitions(is_public, is_showcase_badge, sort_order);

CREATE TABLE IF NOT EXISTS server_visual_preferences (
  linked_server_id TEXT PRIMARY KEY,
  profile_frame_key TEXT,
  theme_banner_key TEXT,
  selected_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_server_visual_preferences_linked_server_id
  ON server_visual_preferences(linked_server_id);
