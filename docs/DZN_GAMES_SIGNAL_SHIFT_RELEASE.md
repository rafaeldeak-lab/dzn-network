# DZN Signal Shift release boundary

Signal Shift is a source-only Games Hub release. It adds a private, server-verified 4x4 tactical slide puzzle with a 72-shift cap, five-minute session expiry, daily reward cap, and atomic XP/parts award.

## Not live through this source release

- `0100_games_hub_signal_shift.sql` has not been applied to production.
- `DZN_GAMES_SIGNAL_SHIFT_ENABLED` remains `false` in production configuration.
- No D1 rows, feature flags, Discord memberships, roles, invitations, messages, payment settings, or customer records are changed by this source work.

## Controlled production sequence

1. Record a private recovery point for the intended D1 database.
2. Apply only `0100_games_hub_signal_shift.sql`.
3. Verify its migration ledger entry, tables, index, constraints, foreign keys, and zero-row baseline.
4. Run authenticated production-safe read and one intentionally controlled game session.
5. Enable only `DZN_GAMES_SIGNAL_SHIFT_ENABLED` after the preceding proof passes.

The mode must remain disabled if any verification fails. Signal Shift does not alter DayZ statistics, competitive eligibility, entitlements, billing, or Discord access.
