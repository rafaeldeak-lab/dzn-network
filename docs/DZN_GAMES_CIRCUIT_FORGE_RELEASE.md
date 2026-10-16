# DZN Circuit Forge production activation

Circuit Forge is a private, server-verified 5x5 relay-routing puzzle with a 64-rotation cap, five-minute session expiry, daily reward cap, and atomic XP/parts award.

## Completed production preflight

- `0101_games_hub_circuit_forge.sql` is present exactly once in the production migration ledger.
- Session and reward-ledger tables, the reward-history index, constraints, and cascading user foreign keys were rechecked against production.
- The production baseline is zero Circuit Forge sessions and zero reward-ledger rows.
- `PRAGMA foreign_key_check` completed successfully with no reported violations.

## Activation boundary

This release enables only `DZN_GAMES_CIRCUIT_FORGE_ENABLED` in the Pages production environment. It does not apply a D1 migration or create player sessions, rewards, Discord memberships, roles, invitations, messages, payment settings, or customer records.

After deployment, the first check is an authenticated, read-only panel load. Circuit Forge does not alter DayZ statistics, competitive eligibility, entitlements, billing, or Discord access.
