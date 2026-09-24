-- Pseudonymize the short-lived Comms receipt and accepted-send ledgers.
-- Production application remains a separate controlled operation.

-- Refuse the cutover while a legacy key still carries an enforceable quota.
-- The activation runbook keeps live sending off and retries after this guard is clear.
CREATE TABLE dzn_comms_rate_cutover_guard (
  ready INTEGER NOT NULL CHECK(ready = 1)
);

INSERT INTO dzn_comms_rate_cutover_guard (ready)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM dzn_comms_attempt_slots
    WHERE minute_bucket = strftime('%Y-%m-%dT%H:%M', 'now')
  ) OR EXISTS (
    SELECT 1 FROM dzn_comms_send_slots
    WHERE minute_bucket = strftime('%Y-%m-%dT%H:%M', 'now')
       OR julianday(accepted_at) > julianday('now', '-5 seconds')
  )
THEN 0 ELSE 1 END;

DROP TABLE dzn_comms_rate_cutover_guard;

DROP INDEX IF EXISTS idx_dzn_comms_receipts_actor_created;
DROP INDEX IF EXISTS idx_dzn_comms_slots_actor_accepted;
DROP INDEX IF EXISTS idx_dzn_comms_slots_created;
DROP INDEX IF EXISTS idx_dzn_comms_attempt_slots_created;

CREATE TABLE dzn_comms_send_receipts_v2 (
  id TEXT PRIMARY KEY,
  actor_receipt_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow', 'block', 'timeout')),
  response_status INTEGER NOT NULL,
  reason_code TEXT,
  message_id TEXT,
  send_rate_key TEXT,
  send_minute_bucket TEXT,
  send_slot INTEGER CHECK(send_slot BETWEEN 1 AND 20),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE(actor_receipt_key, channel_id, client_request_id),
  FOREIGN KEY(channel_id) REFERENCES dzn_comms_channels(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES dzn_comms_messages(id) ON DELETE SET NULL
);

INSERT INTO dzn_comms_send_receipts_v2
  (id, actor_receipt_key, channel_id, client_request_id, body_hash, decision, response_status,
    reason_code, message_id, created_at, expires_at)
SELECT id, lower(hex(randomblob(32))), channel_id, client_request_id, body_hash, decision,
  response_status, reason_code, message_id, created_at, expires_at
FROM dzn_comms_send_receipts;

DROP TABLE dzn_comms_send_receipts;
ALTER TABLE dzn_comms_send_receipts_v2 RENAME TO dzn_comms_send_receipts;

CREATE TABLE dzn_comms_send_slots_v2 (
  actor_rate_key TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 20),
  accepted_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_rate_key, minute_bucket, slot)
);

INSERT INTO dzn_comms_send_slots_v2
  (actor_rate_key, minute_bucket, slot, accepted_at, created_at)
SELECT lower(hex(randomblob(32))), minute_bucket, slot, accepted_at, created_at
FROM dzn_comms_send_slots;

DROP TABLE dzn_comms_send_slots;
ALTER TABLE dzn_comms_send_slots_v2 RENAME TO dzn_comms_send_slots;

CREATE TABLE dzn_comms_attempt_actor_map (
  actor_user_id TEXT PRIMARY KEY,
  actor_attempt_key TEXT NOT NULL UNIQUE
);

INSERT INTO dzn_comms_attempt_actor_map (actor_user_id, actor_attempt_key)
SELECT actor_user_id, lower(hex(randomblob(32)))
FROM dzn_comms_attempt_slots
GROUP BY actor_user_id;

CREATE TABLE dzn_comms_attempt_slots_v2 (
  actor_attempt_key TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 30),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_attempt_key, minute_bucket, slot)
);

INSERT INTO dzn_comms_attempt_slots_v2
  (actor_attempt_key, minute_bucket, slot, created_at)
SELECT actor_map.actor_attempt_key, attempt.minute_bucket, attempt.slot, attempt.created_at
FROM dzn_comms_attempt_slots AS attempt
JOIN dzn_comms_attempt_actor_map AS actor_map ON actor_map.actor_user_id = attempt.actor_user_id;

DROP TABLE dzn_comms_attempt_slots;
ALTER TABLE dzn_comms_attempt_slots_v2 RENAME TO dzn_comms_attempt_slots;
DROP TABLE dzn_comms_attempt_actor_map;

CREATE INDEX idx_dzn_comms_receipts_actor_created
  ON dzn_comms_send_receipts(actor_receipt_key, created_at DESC);
CREATE INDEX idx_dzn_comms_slots_created
  ON dzn_comms_send_slots(created_at);
CREATE INDEX idx_dzn_comms_slots_actor_accepted
  ON dzn_comms_send_slots(actor_rate_key, accepted_at DESC);
CREATE INDEX idx_dzn_comms_attempt_slots_created
  ON dzn_comms_attempt_slots(created_at);
