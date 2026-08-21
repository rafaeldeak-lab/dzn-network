-- DZN linked-server merge-state schema.
-- Additive only. No linked-server rows, ownership, gameplay data,
-- subscriptions, sessions, credentials, or historical records are deleted,
-- reset, transferred, or rewritten.
-- No production migration is authorised by this commit.

ALTER TABLE linked_servers
ADD COLUMN merged_into_server_id TEXT;

ALTER TABLE linked_servers
ADD COLUMN merged_at TEXT;

CREATE INDEX IF NOT EXISTS idx_linked_servers_merged_into_server_id
ON linked_servers(merged_into_server_id);
