-- Reviews foundation reply and moderation hooks.
-- Additive only: does not alter billing, rankings, discovery score, badges, seasons,
-- events, competitive eligibility, ADM stats, kill_events, or player_events.

ALTER TABLE server_reviews ADD COLUMN owner_reply_body TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_author_user_id TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_author_name TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_created_at TEXT;
ALTER TABLE server_reviews ADD COLUMN owner_reply_updated_at TEXT;

CREATE TABLE IF NOT EXISTS server_review_moderation_actions (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_discord_id TEXT,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(review_id) REFERENCES server_reviews(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_review_moderation_actions_review_id
  ON server_review_moderation_actions(review_id);

CREATE INDEX IF NOT EXISTS idx_server_review_moderation_actions_linked_server_id
  ON server_review_moderation_actions(linked_server_id);

CREATE INDEX IF NOT EXISTS idx_server_review_moderation_actions_created_at
  ON server_review_moderation_actions(created_at);
