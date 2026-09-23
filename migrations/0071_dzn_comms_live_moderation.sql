-- Authenticated, moderated DZN Comms runtime.
-- Additive only. Production application remains a separate release operation.

CREATE TABLE IF NOT EXISTS dzn_comms_send_receipts (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow', 'block', 'timeout')),
  response_status INTEGER NOT NULL,
  reason_code TEXT,
  message_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE(actor_user_id, channel_id, client_request_id),
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dzn_comms_send_slots (
  actor_user_id TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 20),
  interval_bucket TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_user_id, minute_bucket, slot),
  UNIQUE(actor_user_id, interval_bucket),
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dzn_comms_attempt_slots (
  actor_user_id TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 30),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_user_id, minute_bucket, slot),
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dzn_comms_report_slots (
  reporter_user_id TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 10),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(reporter_user_id, minute_bucket, slot),
  FOREIGN KEY(reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dzn_comms_timeouts (
  actor_user_id TEXT PRIMARY KEY,
  reason_code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dzn_comms_reports (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN ('harassment', 'hate', 'threat', 'spam', 'personal_information', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by_user_id TEXT,
  UNIQUE(message_id, reporter_user_id),
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(reporter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dzn_comms_moderation_audit (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('hide', 'restore', 'delete', 'resolve_report', 'dismiss_report')),
  reason_code TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_receipts_actor_created
  ON dzn_comms_send_receipts(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_slots_created
  ON dzn_comms_send_slots(created_at);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_attempt_slots_created
  ON dzn_comms_attempt_slots(created_at);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_report_slots_created
  ON dzn_comms_report_slots(created_at);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_reports_status_created
  ON dzn_comms_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_moderation_audit_created
  ON dzn_comms_moderation_audit(created_at DESC);

INSERT INTO dzn_comms_channels (id, slug, kind, name, description, visibility, is_readable)
VALUES ('dzn-global-chat', 'global-chat', 'public', 'Global Chat', 'Live DZN community chat for Discord-authenticated members.', 'public', 1)
ON CONFLICT(slug) DO NOTHING;
