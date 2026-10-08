-- Platform-owner-only Comms message archive.
-- Production application remains a separate controlled operation.

CREATE TABLE IF NOT EXISTS dzn_comms_owner_message_archive (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_user_id TEXT,
  author_display_name TEXT NOT NULL,
  author_role_label TEXT NOT NULL,
  original_body TEXT NOT NULL CHECK(length(original_body) BETWEEN 1 AND 2000),
  sent_at TEXT NOT NULL,
  retained_until TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  deletion_kind TEXT CHECK(deletion_kind IN ('self_deleted', 'moderator_deleted', 'retention_expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(deleted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dzn_comms_owner_message_archive_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('sent', 'self_deleted', 'moderator_deleted', 'retention_expired')),
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES dzn_comms_owner_message_archive(message_id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_owner_message_archive_retained
  ON dzn_comms_owner_message_archive(retained_until, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_owner_message_archive_author
  ON dzn_comms_owner_message_archive(author_user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_owner_message_archive_events_message
  ON dzn_comms_owner_message_archive_events(message_id, created_at DESC);

-- Recover only messages whose original content is still present. Sanitised
-- deleted/expired rows cannot truthfully be reconstructed.
INSERT OR IGNORE INTO dzn_comms_owner_message_archive
  (message_id, channel_id, author_user_id, author_display_name, author_role_label, original_body, sent_at, retained_until)
SELECT id, channel_id, author_user_id, author_display_name, author_role_label, body, created_at,
  COALESCE(NULLIF(expires_at, ''), datetime(created_at, '+30 days'))
FROM dzn_comms_messages
WHERE visibility_state IN ('visible', 'hidden', 'quarantined')
  AND body NOT IN ('Message deleted.', 'Message expired.');
