-- Discord server announcement tracking.
-- Additive only: this migration does not alter gameplay stats, historical events,
-- player profiles, leaderboards, billing, Nitrado tokens, or linked server data.

CREATE TABLE IF NOT EXISTS discord_announcement_posts (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  event_type TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  thread_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_announcement_posts_server_event_created
ON discord_announcement_posts(server_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_discord_announcement_posts_event_status_created
ON discord_announcement_posts(event_type, status, created_at);

CREATE INDEX IF NOT EXISTS idx_discord_announcement_posts_status_updated
ON discord_announcement_posts(status, updated_at);
