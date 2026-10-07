-- Server-owner responses to public reviews. This migration is additive and must
-- be activated through its own production migration and schema-verification run.

ALTER TABLE server_reviews ADD COLUMN owner_reply_body TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_author_user_id TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_author_name TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_created_at TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_updated_at TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS server_review_owner_reply_audit (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_discord_id TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'remove')),
  previous_version INTEGER NOT NULL,
  next_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(review_id) REFERENCES server_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_server_review_owner_reply_audit_review
  ON server_review_owner_reply_audit(review_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_server_review_owner_reply_audit_server
  ON server_review_owner_reply_audit(linked_server_id, created_at DESC);
