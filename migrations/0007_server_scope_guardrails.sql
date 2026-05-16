-- Server scope guardrails for ADM-derived data.
--
-- Nitrado service id is the stable identity for a linked DayZ server.
-- If the active-service unique index fails, run:
--   npm run repair:readded-server -- --service-id SERVICE_ID --dry-run
-- and repair duplicates before applying this migration again.

ALTER TABLE adm_raw_events ADD COLUMN source_service_id TEXT;
ALTER TABLE adm_raw_events ADD COLUMN source_adm_file TEXT;
ALTER TABLE adm_raw_events ADD COLUMN source_line_number INTEGER;
ALTER TABLE adm_raw_events ADD COLUMN source_sync_run_id TEXT;

ALTER TABLE player_events ADD COLUMN source_service_id TEXT;
ALTER TABLE player_events ADD COLUMN source_adm_file TEXT;
ALTER TABLE player_events ADD COLUMN source_line_number INTEGER;
ALTER TABLE player_events ADD COLUMN source_sync_run_id TEXT;

ALTER TABLE kill_events ADD COLUMN source_service_id TEXT;
ALTER TABLE kill_events ADD COLUMN source_adm_file TEXT;
ALTER TABLE kill_events ADD COLUMN source_line_number INTEGER;
ALTER TABLE kill_events ADD COLUMN source_sync_run_id TEXT;

ALTER TABLE player_profiles ADD COLUMN source_service_id TEXT;
ALTER TABLE server_stats ADD COLUMN source_service_id TEXT;
ALTER TABLE adm_sync_state ADD COLUMN source_service_id TEXT;
ALTER TABLE sync_runs ADD COLUMN source_service_id TEXT;

UPDATE adm_raw_events
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = adm_raw_events.linked_server_id)),
    source_adm_file = COALESCE(source_adm_file, adm_file),
    source_line_number = COALESCE(source_line_number, line_number);

UPDATE player_events
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = player_events.linked_server_id)),
    source_adm_file = COALESCE(source_adm_file, adm_file),
    source_line_number = COALESCE(source_line_number, line_number);

UPDATE kill_events
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = kill_events.linked_server_id)),
    source_adm_file = COALESCE(source_adm_file, adm_file),
    source_line_number = COALESCE(source_line_number, line_number);

UPDATE player_profiles
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = player_profiles.linked_server_id));

UPDATE server_stats
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = server_stats.linked_server_id));

UPDATE adm_sync_state
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = adm_sync_state.linked_server_id));

UPDATE sync_runs
SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = sync_runs.linked_server_id));

CREATE UNIQUE INDEX IF NOT EXISTS idx_linked_servers_active_service_id
ON linked_servers(nitrado_service_id)
WHERE nitrado_service_id IS NOT NULL
  AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted');

CREATE UNIQUE INDEX IF NOT EXISTS idx_kill_events_service_file_line
ON kill_events(source_service_id, source_adm_file, source_line_number)
WHERE source_service_id IS NOT NULL
  AND source_adm_file IS NOT NULL
  AND source_line_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_adm_raw_events_service_file_line
ON adm_raw_events(source_service_id, source_adm_file, source_line_number);

CREATE INDEX IF NOT EXISTS idx_player_events_service_file_line
ON player_events(source_service_id, source_adm_file, source_line_number);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source_service_id ON sync_runs(source_service_id);
