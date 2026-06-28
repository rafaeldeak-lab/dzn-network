-- DZN server advertising package metadata.
-- Additive only: no existing competitive/stat/cache tables are rewritten.

ALTER TABLE server_advertising_state ADD COLUMN next_bump_at TEXT;

ALTER TABLE linked_servers ADD COLUMN advert_banner_url TEXT;
ALTER TABLE linked_servers ADD COLUMN advert_banner_alt TEXT;
ALTER TABLE linked_servers ADD COLUMN owner_announcement TEXT;
ALTER TABLE linked_servers ADD COLUMN fresh_wipe_promo TEXT;
ALTER TABLE linked_servers ADD COLUMN discord_embed_banner_url TEXT;
ALTER TABLE linked_servers ADD COLUMN discord_embed_accent_color TEXT;

CREATE INDEX IF NOT EXISTS idx_server_advertising_state_next_bump_at
  ON server_advertising_state(next_bump_at);

CREATE INDEX IF NOT EXISTS idx_server_advertising_state_last_bumped_at
  ON server_advertising_state(last_bumped_at);

CREATE TABLE IF NOT EXISTS server_gallery_images (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  url TEXT NOT NULL,
  storage_path TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_gallery_images_server_sort
  ON server_gallery_images(server_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS server_listing_events (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  user_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_listing_events_server_type_created
  ON server_listing_events(server_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_server_listing_events_user_type_created
  ON server_listing_events(user_id, event_type, created_at);
