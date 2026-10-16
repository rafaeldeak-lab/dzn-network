-- One-time, ledger-backed recovery for historical runtime schema upgrades.
-- Production application is a separate controlled D1 operation.
UPDATE automation_cron_runs
SET job_type = COALESCE(NULLIF(job_type, ''), NULLIF(endpoint, ''), 'metadata')
WHERE job_type IS NULL OR job_type = '';

UPDATE automation_cron_runs
SET started_at = COALESCE(started_at, created_at)
WHERE started_at IS NULL;

UPDATE automation_cron_runs
SET finished_at = COALESCE(finished_at, created_at)
WHERE finished_at IS NULL;

UPDATE automation_cron_runs
SET status = 'success'
WHERE status IN ('completed', 'manual');
