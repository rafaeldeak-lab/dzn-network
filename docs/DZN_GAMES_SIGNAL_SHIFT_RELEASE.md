# DZN Signal Shift activation release

Signal Shift is a private, server-verified 4x4 tactical slide puzzle with a 72-shift cap, five-minute session expiry, daily reward cap, and atomic XP/parts award.

## Activation boundary

`0100_games_hub_signal_shift.sql` was previously applied and independently verified in production. This release enables only `DZN_GAMES_SIGNAL_SHIFT_ENABLED=true` in the Pages production configuration.

No D1 migration, Discord membership, role, invitation, message, payment setting, customer record, or player progress is changed by this release outside normal authenticated game play.

## Completed production preflight

1. `0100_games_hub_signal_shift.sql` appears exactly once in the production migration ledger.
2. Its session and reward-ledger tables, reward-history index, constraints, and cascading foreign keys match the approved migration.
3. Both Signal Shift tables have a zero-row baseline and `PRAGMA foreign_key_check` passed.
4. A read-only authenticated production panel load is required after deployment. It must not start a session or expose the private board layout.

Signal Shift does not alter DayZ statistics, competitive eligibility, entitlements, billing, or Discord access.
