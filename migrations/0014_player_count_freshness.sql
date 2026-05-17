ALTER TABLE linked_servers ADD COLUMN player_count_last_checked_at TEXT;
ALTER TABLE linked_servers ADD COLUMN player_count_source TEXT;
ALTER TABLE linked_servers ADD COLUMN player_count_status TEXT;

UPDATE linked_servers
SET
  player_count_last_checked_at = COALESCE(player_count_last_checked_at, metadata_last_checked_at),
  player_count_source = COALESCE(player_count_source, 'nitrado'),
  player_count_status = COALESCE(
    player_count_status,
    CASE
      WHEN metadata_last_checked_at IS NOT NULL THEN 'stale'
      ELSE 'unknown'
    END
  );

CREATE INDEX IF NOT EXISTS idx_linked_servers_player_count_last_checked_at
ON linked_servers(player_count_last_checked_at);
