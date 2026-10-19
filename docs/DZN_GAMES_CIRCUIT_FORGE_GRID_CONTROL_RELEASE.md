# DZN Circuit Forge Grid Control activation

The Grid Control extension adds one server-authoritative topology diagnostic and one server-authoritative 180 degree phase action to each Circuit Forge board. It does not change rewards, XP, parts, DayZ statistics, competition eligibility, entitlements, billing, Discord access, or player identity data.

## Source release boundary

`0111_games_hub_circuit_forge_grid_control.sql` is additive to the existing Circuit Forge session table. It is intentionally not applied by this source release, and `DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED` is absent from both preview and production configuration.

## Required production operation

1. Record a private D1 Time Travel recovery bookmark.
2. Confirm the exact approved `main` commit and that `0111_games_hub_circuit_forge_grid_control.sql` is the only migration selected for the operation.
3. Verify the ledger before applying it. Do not combine it with any other migration or feature flag change.
4. Apply `0111` by itself.
5. Verify the ledger entry, `dzn_circuit_forge_sessions` columns (`diagnostic_used`, `phase_used`, `diagnostic_index`), `idx_dzn_circuit_forge_grid_control`, column constraints, foreign-key check, and that the migration did not create session or reward rows.
6. Deploy the already-reviewed source release, then enable only `DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED` on production.
7. With an authenticated controlled account, start one board; verify one diagnostic, one phase action, stale-action rejection, public reward integrity, and a fresh-board reset. Keep the flag off if any verification fails.

The phase action, diagnostic selection, session version, rotation accounting, and daily reward write are all verified server-side. The browser never receives the solved rotation sequence.
