CREATE TABLE IF NOT EXISTS badge_audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  server_id TEXT,
  badge_code TEXT,
  previous_server_id TEXT,
  actor_user_id TEXT,
  actor_role TEXT,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_badge_audit_log_server ON badge_audit_log(server_id, created_at);
CREATE INDEX IF NOT EXISTS idx_badge_audit_log_badge ON badge_audit_log(badge_code, created_at);
CREATE INDEX IF NOT EXISTS idx_badge_audit_log_action ON badge_audit_log(action, created_at);
