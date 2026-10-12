# DZN Circuit Forge release boundary

Circuit Forge is a source-only Games Hub release. It adds a private, server-verified 5x5 relay-routing puzzle with a 64-rotation cap, five-minute session expiry, daily reward cap, and atomic XP/parts award.

## Not live through this source release

- `0101_games_hub_circuit_forge.sql` has not been applied to production.
- `DZN_GAMES_CIRCUIT_FORGE_ENABLED` remains `false` in production configuration.
- No D1 rows, feature flags, Discord memberships, roles, invitations, messages, payment settings, or customer records are changed by this source work.

## Controlled production sequence

1. Record a private recovery point for the intended D1 database.
2. Apply only `0101_games_hub_circuit_forge.sql`.
3. Verify its migration ledger entry, tables, index, constraints, foreign keys, and zero-row baseline.
4. Run an authenticated production-safe read and one intentionally controlled game session.
5. Enable only `DZN_GAMES_CIRCUIT_FORGE_ENABLED` after the preceding proof passes.

The mode must remain disabled if any verification fails. Circuit Forge does not alter DayZ statistics, competitive eligibility, entitlements, billing, or Discord access.
