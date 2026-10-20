# DZN Per-Server Status Evidence Release

`0113_dzn_server_status_evidence.sql` adds a nullable `linked_servers.server_status_confirmed_at` field.

It records a successful complete metadata response for the same linked server. A failed refresh, a player-count-only refresh, a stale retained value, and a shared guild cache entry are not evidence of a server's current online state.

This release contains no feature activation. After source review and merge, apply only `0113` through the guarded single-migration workflow. Capture the workflow recovery bookmark and require its ledger, schema, foreign-key, row-preservation, and NULL-baseline checks to pass. Public display consumption is a separately reviewed release.
