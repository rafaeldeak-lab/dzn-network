CREATE TABLE IF NOT EXISTS server_reviews (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  reviewer_discord_id TEXT NOT NULL,
  reviewer_name TEXT,
  reviewer_avatar_url TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  moderation_reason TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_edited_at TEXT,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_server_reviews_linked_server_id
ON server_reviews(linked_server_id);

CREATE INDEX IF NOT EXISTS idx_server_reviews_reviewer_discord_id
ON server_reviews(reviewer_discord_id);

CREATE INDEX IF NOT EXISTS idx_server_reviews_status
ON server_reviews(status);

CREATE INDEX IF NOT EXISTS idx_server_reviews_created_at
ON server_reviews(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_reviews_one_active_per_user
ON server_reviews(linked_server_id, reviewer_discord_id)
WHERE status != 'deleted';

CREATE TABLE IF NOT EXISTS server_review_reports (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  reporter_discord_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(review_id) REFERENCES server_reviews(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_server_review_reports_one_per_user
ON server_review_reports(review_id, reporter_discord_id);

CREATE INDEX IF NOT EXISTS idx_server_review_reports_review_id
ON server_review_reports(review_id);
