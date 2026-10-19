# DZN Circuit Forge Grid Control activation

The Grid Control extension adds one server-authoritative topology diagnostic and one server-authoritative phase alignment to each Circuit Forge board. It does not change rewards, XP, parts, DayZ statistics, competition eligibility, entitlements, billing, Discord access, or player identity data.

## Rollout record

`0111_games_hub_circuit_forge_grid_control.sql` was applied by itself in [production workflow run #15](https://github.com/rafaeldeak-lab/dzn-network/actions/runs/39338604999). The run recorded a private recovery bookmark and passed the migration ledger, table schema, index, constraint, foreign-key, and preserved-session/default checks before and after the write.

The temporary Circuit Forge maintenance guard was then removed in a separate deployed release. `DZN_GAMES_CIRCUIT_FORGE_GRID_CONTROL_ENABLED` is enabled only in production; it remains absent from preview configuration. Standard Circuit Forge writes and account deletion are restored.

## Remaining live observation

The first authenticated player board must naturally confirm one diagnostic, one phase action, stale-action rejection, public reward integrity, and fresh-board reset. No gameplay session or progression event is fabricated for this release. Keep the feature flag off if a real player observation identifies a defect.

The phase action, diagnostic selection, session version, rotation accounting, and daily reward write are all verified server-side. The browser never receives the solved rotation sequence.
