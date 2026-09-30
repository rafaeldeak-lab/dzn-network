ALTER TABLE server_reviews ADD COLUMN moderation_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE server_reviews ADD COLUMN moderation_decision_id TEXT;

ALTER TABLE server_review_reports ADD COLUMN resolution_status TEXT;
ALTER TABLE server_review_reports ADD COLUMN resolved_at TEXT;
ALTER TABLE server_review_reports ADD COLUMN resolved_by_user_id TEXT;

DROP INDEX IF EXISTS idx_server_review_reports_one_per_user;
CREATE UNIQUE INDEX idx_server_review_reports_one_per_user
  ON server_review_reports(review_id, reporter_discord_id)
  WHERE resolution_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_server_review_reports_resolution
  ON server_review_reports(resolution_status, created_at);

CREATE TABLE IF NOT EXISTS server_review_moderation_audit (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_discord_id TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('approve', 'hide')),
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(review_id) REFERENCES server_reviews(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_review_moderation_audit_created
  ON server_review_moderation_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_server_review_moderation_audit_review
  ON server_review_moderation_audit(review_id, created_at DESC);
