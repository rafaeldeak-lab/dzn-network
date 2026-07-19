CREATE TABLE IF NOT EXISTS discord_channel_mappings (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL UNIQUE,
  guild_id TEXT NOT NULL,
  guild_name TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_permission_status TEXT,
  last_permission_checked_at TEXT,
  last_permission_error TEXT,
  last_permission_json TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_channel_mappings_slot
ON discord_channel_mappings(slot);

CREATE INDEX IF NOT EXISTS idx_discord_channel_mappings_guild_channel
ON discord_channel_mappings(guild_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_discord_channel_mappings_enabled
ON discord_channel_mappings(enabled, updated_at);

CREATE TABLE IF NOT EXISTS discord_owner_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_discord_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_slot TEXT,
  guild_id TEXT,
  channel_id TEXT,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL,
  reason TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_owner_audit_log_created_at
ON discord_owner_audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_discord_owner_audit_log_action
ON discord_owner_audit_log(action, created_at);

CREATE INDEX IF NOT EXISTS idx_discord_owner_audit_log_target
ON discord_owner_audit_log(target_type, target_slot, created_at);
