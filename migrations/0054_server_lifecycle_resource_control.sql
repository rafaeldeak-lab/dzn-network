-- Server lifecycle/resource-control metadata.
-- Additive only: this migration preserves all historical stats, ADM events,
-- player history, leaderboard history, sessions, and subscriptions.

ALTER TABLE linked_servers ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active_live';
ALTER TABLE linked_servers ADD COLUMN lifecycle_reason TEXT;
ALTER TABLE linked_servers ADD COLUMN lifecycle_updated_at TEXT;
ALTER TABLE linked_servers ADD COLUMN owner_action_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN owner_action_reason TEXT;
ALTER TABLE linked_servers ADD COLUMN stale_since TEXT;
ALTER TABLE linked_servers ADD COLUMN expired_detected_at TEXT;
ALTER TABLE linked_servers ADD COLUMN final_sync_attempted_at TEXT;
ALTER TABLE linked_servers ADD COLUMN final_sync_completed_at TEXT;
ALTER TABLE linked_servers ADD COLUMN final_sync_result TEXT;
ALTER TABLE linked_servers ADD COLUMN final_adm_filename TEXT;
ALTER TABLE linked_servers ADD COLUMN latest_imported_event_at TEXT;
ALTER TABLE linked_servers ADD COLUMN auto_archive_after TEXT;

ALTER TABLE server_sync_state ADD COLUMN next_metadata_check_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN next_player_count_check_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN next_adm_discovery_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN next_adm_processing_at TEXT;
ALTER TABLE server_sync_state ADD COLUMN next_retry_after TEXT;
ALTER TABLE server_sync_state ADD COLUMN last_skip_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_linked_servers_lifecycle_status
ON linked_servers(lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_linked_servers_lifecycle_visibility
ON linked_servers(lifecycle_status, status, listing_visibility);

CREATE INDEX IF NOT EXISTS idx_linked_servers_owner_action
ON linked_servers(owner_action_required, lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_server_sync_state_metadata_due
ON server_sync_state(next_metadata_check_at);

CREATE INDEX IF NOT EXISTS idx_server_sync_state_player_count_due
ON server_sync_state(next_player_count_check_at);

CREATE INDEX IF NOT EXISTS idx_server_sync_state_lifecycle_retry
ON server_sync_state(next_retry_after, last_skip_reason);
