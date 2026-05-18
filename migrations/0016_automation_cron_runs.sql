CREATE TABLE IF NOT EXISTS automation_cron_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_created_at ON automation_cron_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_source ON automation_cron_runs(source);
