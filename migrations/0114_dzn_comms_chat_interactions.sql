-- DZN Comms custom emoji reactions and short-lived typing state.
-- Additive only. Runtime activation is a separate, reviewed production operation.

CREATE TABLE IF NOT EXISTS dzn_comms_custom_emoji_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reaction_key TEXT NOT NULL CHECK(length(reaction_key) BETWEEN 8 AND 64),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT,
  UNIQUE(message_id, actor_user_id, reaction_key),
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_custom_emoji_reactions_message_active
  ON dzn_comms_custom_emoji_reactions(message_id, active, reaction_key);

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reaction_visible_insert
BEFORE INSERT ON dzn_comms_custom_emoji_reactions
WHEN NEW.active = 1 AND NOT EXISTS (
  SELECT 1 FROM dzn_comms_messages
  WHERE id = NEW.message_id
    AND visibility_state = 'visible'
    AND (expires_at IS NULL OR expires_at = '' OR julianday(expires_at) > julianday('now'))
)
BEGIN
  SELECT RAISE(ABORT, 'reaction message unavailable');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reaction_visible_reactivate
BEFORE UPDATE OF active ON dzn_comms_custom_emoji_reactions
WHEN NEW.active = 1 AND OLD.active = 0 AND NOT EXISTS (
  SELECT 1 FROM dzn_comms_messages
  WHERE id = NEW.message_id
    AND visibility_state = 'visible'
    AND (expires_at IS NULL OR expires_at = '' OR julianday(expires_at) > julianday('now'))
)
BEGIN
  SELECT RAISE(ABORT, 'reaction message unavailable');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reaction_actor_cap_insert
BEFORE INSERT ON dzn_comms_custom_emoji_reactions
WHEN NEW.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM dzn_comms_custom_emoji_reactions
    WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id
      AND reaction_key = NEW.reaction_key AND active = 1
  )
  AND (
    SELECT COUNT(*) FROM (
      SELECT id FROM dzn_comms_message_reactions
      WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
      UNION ALL
      SELECT id FROM dzn_comms_custom_emoji_reactions
      WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
    )
  ) >= 8
BEGIN
  SELECT RAISE(ABORT, 'reaction actor cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reaction_actor_cap_reactivate
BEFORE UPDATE OF active ON dzn_comms_custom_emoji_reactions
WHEN NEW.active = 1 AND OLD.active = 0 AND (
  SELECT COUNT(*) FROM (
    SELECT id FROM dzn_comms_message_reactions
    WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
    UNION ALL
    SELECT id FROM dzn_comms_custom_emoji_reactions
    WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
  )
) >= 8
BEGIN
  SELECT RAISE(ABORT, 'reaction actor cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reaction_message_cap_insert
BEFORE INSERT ON dzn_comms_custom_emoji_reactions
WHEN NEW.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM dzn_comms_custom_emoji_reactions
    WHERE message_id = NEW.message_id AND reaction_key = NEW.reaction_key AND active = 1
  )
  AND (
    SELECT COUNT(DISTINCT reaction_key) FROM (
      SELECT reaction_key FROM dzn_comms_message_reactions
      WHERE message_id = NEW.message_id AND active = 1
      UNION
      SELECT reaction_key FROM dzn_comms_custom_emoji_reactions
      WHERE message_id = NEW.message_id AND active = 1
    )
  ) >= 24
BEGIN
  SELECT RAISE(ABORT, 'reaction message cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reaction_message_cap_reactivate
BEFORE UPDATE OF active ON dzn_comms_custom_emoji_reactions
WHEN NEW.active = 1 AND OLD.active = 0 AND (
  SELECT COUNT(DISTINCT reaction_key) FROM (
    SELECT reaction_key FROM dzn_comms_message_reactions
    WHERE message_id = NEW.message_id AND active = 1
    UNION
    SELECT reaction_key FROM dzn_comms_custom_emoji_reactions
    WHERE message_id = NEW.message_id AND active = 1
  )
) >= 24
BEGIN
  SELECT RAISE(ABORT, 'reaction message cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_custom_emoji_reactions_message_unavailable
AFTER UPDATE OF visibility_state ON dzn_comms_messages
WHEN NEW.visibility_state != 'visible'
BEGIN
  UPDATE dzn_comms_custom_emoji_reactions
  SET active = 0, updated_at = CURRENT_TIMESTAMP, removed_at = CURRENT_TIMESTAMP
  WHERE message_id = NEW.id AND active = 1;
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_legacy_reaction_actor_cap_insert
BEFORE INSERT ON dzn_comms_message_reactions
WHEN NEW.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM dzn_comms_message_reactions
    WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id
      AND reaction_key = NEW.reaction_key AND active = 1
  )
  AND (
    SELECT COUNT(*) FROM (
      SELECT id FROM dzn_comms_message_reactions
      WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
      UNION ALL
      SELECT id FROM dzn_comms_custom_emoji_reactions
      WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
    )
  ) >= 8
BEGIN
  SELECT RAISE(ABORT, 'reaction actor cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_legacy_reaction_actor_cap_reactivate
BEFORE UPDATE OF active ON dzn_comms_message_reactions
WHEN NEW.active = 1 AND OLD.active = 0 AND (
  SELECT COUNT(*) FROM (
    SELECT id FROM dzn_comms_message_reactions
    WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
    UNION ALL
    SELECT id FROM dzn_comms_custom_emoji_reactions
    WHERE message_id = NEW.message_id AND actor_user_id = NEW.actor_user_id AND active = 1
  )
) >= 8
BEGIN
  SELECT RAISE(ABORT, 'reaction actor cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_legacy_reaction_message_cap_insert
BEFORE INSERT ON dzn_comms_message_reactions
WHEN NEW.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM dzn_comms_message_reactions
    WHERE message_id = NEW.message_id AND reaction_key = NEW.reaction_key AND active = 1
  )
  AND (
    SELECT COUNT(DISTINCT reaction_key) FROM (
      SELECT reaction_key FROM dzn_comms_message_reactions
      WHERE message_id = NEW.message_id AND active = 1
      UNION
      SELECT reaction_key FROM dzn_comms_custom_emoji_reactions
      WHERE message_id = NEW.message_id AND active = 1
    )
  ) >= 24
BEGIN
  SELECT RAISE(ABORT, 'reaction message cap reached');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_legacy_reaction_message_cap_reactivate
BEFORE UPDATE OF active ON dzn_comms_message_reactions
WHEN NEW.active = 1 AND OLD.active = 0 AND (
  SELECT COUNT(DISTINCT reaction_key) FROM (
    SELECT reaction_key FROM dzn_comms_message_reactions
    WHERE message_id = NEW.message_id AND active = 1
    UNION
    SELECT reaction_key FROM dzn_comms_custom_emoji_reactions
    WHERE message_id = NEW.message_id AND active = 1
  )
) >= 24
BEGIN
  SELECT RAISE(ABORT, 'reaction message cap reached');
END;

CREATE TABLE IF NOT EXISTS dzn_comms_typing_sessions (
  channel_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 60),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, actor_user_id),
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_typing_channel_expiry
  ON dzn_comms_typing_sessions(channel_id, expires_at, updated_at);
