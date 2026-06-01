-- Additive owner-facing server listing settings and category fairness audit.
-- Do not remove, reset, or rewrite historical ADM/player/profile data.

ALTER TABLE linked_servers ADD COLUMN category_changed_at TEXT;
ALTER TABLE linked_servers ADD COLUMN category_cooldown_until TEXT;
ALTER TABLE linked_servers ADD COLUMN category_effective_at TEXT;
ALTER TABLE linked_servers ADD COLUMN category_first_set_at TEXT;
ALTER TABLE linked_servers ADD COLUMN category_first_grace_used_at TEXT;
ALTER TABLE linked_servers ADD COLUMN category_locked_until TEXT;
ALTER TABLE linked_servers ADD COLUMN category_lock_reason TEXT;
ALTER TABLE linked_servers ADD COLUMN listing_visibility TEXT DEFAULT 'public';
ALTER TABLE linked_servers ADD COLUMN tags_changed_at TEXT;
ALTER TABLE linked_servers ADD COLUMN tags_cooldown_until TEXT;

CREATE TABLE IF NOT EXISTS server_category_change_events (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  linked_server_id TEXT,
  nitrado_service_id TEXT,
  changed_by_user_id TEXT NOT NULL,
  old_category TEXT,
  new_category TEXT NOT NULL,
  reason TEXT,
  source TEXT NOT NULL,
  plan_key_at_change TEXT,
  effective_at TEXT,
  cooldown_until TEXT,
  grace_used INTEGER DEFAULT 0,
  override_used INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_category_change_events_server_created
ON server_category_change_events(linked_server_id, created_at);

CREATE INDEX IF NOT EXISTS idx_server_category_change_events_user_created
ON server_category_change_events(changed_by_user_id, created_at);

CREATE TABLE IF NOT EXISTS server_listing_change_events (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  changed_by_user_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_listing_change_events_server_type_created
ON server_listing_change_events(server_id, change_type, created_at);

CREATE INDEX IF NOT EXISTS idx_linked_servers_listing_visibility
ON linked_servers(listing_visibility);
