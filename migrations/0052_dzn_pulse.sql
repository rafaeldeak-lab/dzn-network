CREATE TABLE IF NOT EXISTS notification_campaigns (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  action_url TEXT,
  event_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  audience_metadata TEXT,
  metadata TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(event_id) REFERENCES competitive_events(id),
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_active_priority
ON notification_campaigns(starts_at, ends_at, priority);

CREATE INDEX IF NOT EXISTS idx_notification_campaigns_event_id
ON notification_campaigns(event_id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT,
  campaign_id TEXT,
  event_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  action_url TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  metadata TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(campaign_id) REFERENCES notification_campaigns(id),
  FOREIGN KEY(event_id) REFERENCES competitive_events(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_user_dedupe
ON user_notifications(user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read_created
ON user_notifications(user_id, read_at, created_at);

CREATE INDEX IF NOT EXISTS idx_user_notifications_expires_at
ON user_notifications(expires_at);

CREATE INDEX IF NOT EXISTS idx_user_notifications_server_id
ON user_notifications(server_id);

CREATE INDEX IF NOT EXISTS idx_user_notifications_event_id
ON user_notifications(event_id);

CREATE INDEX IF NOT EXISTS idx_user_notifications_campaign_id
ON user_notifications(campaign_id);

CREATE TABLE IF NOT EXISTS event_popup_dismissals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT,
  campaign_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('snooze', 'forever', 'joined')),
  snoozed_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(server_id) REFERENCES linked_servers(id),
  FOREIGN KEY(campaign_id) REFERENCES notification_campaigns(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_popup_dismissals_user_campaign_scope
ON event_popup_dismissals(user_id, campaign_id, scope_key);

CREATE INDEX IF NOT EXISTS idx_event_popup_dismissals_campaign
ON event_popup_dismissals(campaign_id);

CREATE INDEX IF NOT EXISTS idx_event_popup_dismissals_server
ON event_popup_dismissals(server_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  discord_enabled INTEGER NOT NULL DEFAULT 0,
  events_enabled INTEGER NOT NULL DEFAULT 1,
  scores_enabled INTEGER NOT NULL DEFAULT 1,
  achievements_enabled INTEGER NOT NULL DEFAULT 1,
  news_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
