-- DZN Comms message/read model local/test foundation.
-- Adds only the approved read-focused schema for disabled-by-default message
-- history reads. This migration does not add sending, reactions, reports,
-- moderation mutations, DZN Assist AI runtime, WebSockets, Durable Objects,
-- analytics, Store/payment writes, live checkout, retained exports, or
-- production-service mutation.

CREATE TABLE IF NOT EXISTS dzn_comms_channels (
  id TEXT PRIMARY KEY,
  channel_key TEXT NOT NULL UNIQUE,
  channel_type TEXT NOT NULL CHECK(channel_type IN ('public', 'private_group')),
  label TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('dzn-public', 'dzn-private-group')),
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK(is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(channel_key GLOB '[a-z0-9][a-z0-9_-]*')
);

CREATE TABLE IF NOT EXISTS dzn_comms_channel_memberships (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  membership_state TEXT NOT NULL DEFAULT 'active' CHECK(membership_state IN ('active', 'pending', 'removed', 'expired')),
  source TEXT NOT NULL CHECK(source IN (
    'trusted_dzn_user_bridge',
    'owner_admin_private_group',
    'server_staff_bridge',
    'local_test_seed'
  )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  UNIQUE(channel_id, user_id),
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dzn_comms_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_user_id TEXT,
  author_display_name TEXT NOT NULL,
  author_role_label TEXT,
  author_avatar_initials TEXT,
  author_profile_href TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK(visibility IN (
    'visible',
    'locked',
    'hidden',
    'deleted',
    'quarantined',
    'expired',
    'staff_only',
    'unavailable'
  )),
  message_kind TEXT NOT NULL DEFAULT 'user_message' CHECK(message_kind IN (
    'user_message',
    'system_notice',
    'pinned_guidance',
    'safety_notice'
  )),
  reply_to_message_id TEXT,
  source TEXT NOT NULL DEFAULT 'local_test_seed' CHECK(source IN (
    'local_test_seed',
    'server_authored',
    'trusted_import'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  expires_at TEXT,
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(author_user_id) REFERENCES users(id),
  FOREIGN KEY(reply_to_message_id) REFERENCES dzn_comms_messages(id)
);

CREATE TABLE IF NOT EXISTS dzn_comms_message_visibility_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  previous_visibility TEXT CHECK(previous_visibility IS NULL OR previous_visibility IN (
    'visible',
    'locked',
    'hidden',
    'deleted',
    'quarantined',
    'expired',
    'staff_only',
    'unavailable'
  )),
  next_visibility TEXT NOT NULL CHECK(next_visibility IN (
    'visible',
    'locked',
    'hidden',
    'deleted',
    'quarantined',
    'expired',
    'staff_only',
    'unavailable'
  )),
  reason_code TEXT,
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_channels_key_type_enabled
  ON dzn_comms_channels(channel_key, channel_type, is_enabled);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_channel_memberships_user_state
  ON dzn_comms_channel_memberships(user_id, membership_state, expires_at);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_channel_memberships_channel_user_state
  ON dzn_comms_channel_memberships(channel_id, user_id, membership_state, expires_at);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_messages_channel_visible_created
  ON dzn_comms_messages(channel_id, visibility, created_at, id);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_messages_author_created
  ON dzn_comms_messages(author_user_id, created_at)
  WHERE author_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dzn_comms_visibility_events_message_created
  ON dzn_comms_message_visibility_events(message_id, created_at);
