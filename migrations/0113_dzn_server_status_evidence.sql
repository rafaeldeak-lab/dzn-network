-- Per-linked-server status evidence. This value is advanced only by a complete
-- successful Nitrado metadata response for the same linked server. Failed and
-- player-count-only refreshes must never advance it.
--
-- Apply independently after 0112. Public status presentation consumes this
-- field in a separate reviewed release after the ledger, schema, foreign-key,
-- state-preservation, and NULL-baseline verification passes.
ALTER TABLE linked_servers
  ADD COLUMN server_status_confirmed_at TEXT;
