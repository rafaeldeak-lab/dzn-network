-- DZN Comms read-history foundation.
-- Local/test schema only until a later production migration approval.
-- This defines a read model for approved channel history; it does not add
-- sending, reactions, report actions, moderation mutations, AI support, or
-- WebSocket/Durable Object runtime.

CREATE TABLE IF NOT EXISTS dzn_comms_channels (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('public', 'private_group', 'support')),
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private_group', 'support_private')),
  is_readable INTEGER NOT NULL DEFAULT 1 CHECK(is_readable IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dzn_comms_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_user_id TEXT,
  author_display_name TEXT NOT NULL,
  author_role_label TEXT NOT NULL DEFAULT 'Member',
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible', 'hidden', 'deleted', 'quarantined', 'expired')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  expires_at TEXT,
  source_label TEXT NOT NULL DEFAULT 'seeded_read_model',
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dzn_comms_private_group_members (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'moderator', 'member')),
  membership_state TEXT NOT NULL DEFAULT 'active' CHECK(membership_state IN ('active', 'removed', 'blocked')),
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(channel_id, user_id),
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_channels_slug_readable
  ON dzn_comms_channels(slug, is_readable, visibility);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_messages_channel_created
  ON dzn_comms_messages(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_messages_visibility
  ON dzn_comms_messages(channel_id, visibility_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_private_group_members_user
  ON dzn_comms_private_group_members(user_id, membership_state, channel_id);
