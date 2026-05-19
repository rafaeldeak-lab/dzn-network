ALTER TABLE automation_cron_runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE automation_cron_runs ADD COLUMN processed_count INTEGER;
ALTER TABLE automation_cron_runs ADD COLUMN skipped_count INTEGER;
ALTER TABLE automation_cron_runs ADD COLUMN failed_count INTEGER;
