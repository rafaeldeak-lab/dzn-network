-- Per-linked-server status evidence. A row is written only after a complete
-- successful Nitrado metadata response for the same linked server. Failed and
-- player-count-only refreshes must never write or advance it.
--
-- Apply independently after 0112. Public status presentation consumes this
-- table in a separate reviewed release after the ledger, schema, foreign-key,
-- and zero-row baseline verification passes. Keeping this evidence out of the
-- very wide linked_servers table avoids altering production server records.
CREATE TABLE dzn_server_status_evidence (
  server_id TEXT PRIMARY KEY NOT NULL REFERENCES linked_servers(id) ON DELETE CASCADE,
  server_status_confirmed_at TEXT NOT NULL
);
