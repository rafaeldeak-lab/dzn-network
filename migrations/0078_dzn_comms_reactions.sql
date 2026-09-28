-- Disabled-by-default DZN Comms message reactions.
-- Additive only. Production application remains a separate release operation.

CREATE TABLE IF NOT EXISTS dzn_comms_message_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reaction_key TEXT NOT NULL CHECK(reaction_key IN ('heart', 'boost', 'laugh', 'salute', 'fire', 'skull')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT,
  UNIQUE(message_id, actor_user_id, reaction_key),
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dzn_comms_reaction_mutations (
  id TEXT PRIMARY KEY,
  actor_mutation_key TEXT NOT NULL UNIQUE,
  message_id TEXT,
  reaction_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('add', 'remove')),
  request_hash TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('added', 'already_present', 'removed', 'already_absent')),
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dzn_comms_reaction_rate_slots (
  actor_rate_key TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 30),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_rate_key, minute_bucket, slot)
);

CREATE INDEX IF NOT EXISTS idx_dzn_comms_reactions_message_active
  ON dzn_comms_message_reactions(message_id, active, reaction_key);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_reaction_mutations_expiry
  ON dzn_comms_reaction_mutations(expires_at);
CREATE INDEX IF NOT EXISTS idx_dzn_comms_reaction_rate_created
  ON dzn_comms_reaction_rate_slots(created_at);

CREATE TRIGGER IF NOT EXISTS dzn_comms_reaction_visible_insert
BEFORE INSERT ON dzn_comms_message_reactions
WHEN NEW.active = 1 AND NOT EXISTS (
  SELECT 1 FROM dzn_comms_messages
  WHERE id = NEW.message_id
    AND visibility_state = 'visible'
    AND (expires_at IS NULL OR expires_at = '' OR julianday(expires_at) > julianday('now'))
)
BEGIN
  SELECT RAISE(ABORT, 'reaction message unavailable');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_reaction_visible_reactivate
BEFORE UPDATE OF active ON dzn_comms_message_reactions
WHEN NEW.active = 1 AND OLD.active = 0 AND NOT EXISTS (
  SELECT 1 FROM dzn_comms_messages
  WHERE id = NEW.message_id
    AND visibility_state = 'visible'
    AND (expires_at IS NULL OR expires_at = '' OR julianday(expires_at) > julianday('now'))
)
BEGIN
  SELECT RAISE(ABORT, 'reaction message unavailable');
END;

CREATE TRIGGER IF NOT EXISTS dzn_comms_reactions_message_unavailable
AFTER UPDATE OF visibility_state ON dzn_comms_messages
WHEN NEW.visibility_state != 'visible'
BEGIN
  UPDATE dzn_comms_message_reactions
  SET active = 0, updated_at = CURRENT_TIMESTAMP, removed_at = CURRENT_TIMESTAMP
  WHERE message_id = NEW.id AND active = 1;
END;
