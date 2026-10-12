# DZN Relay Rush Release

## Scope

This release adds Relay Rush as an original fifth playable title in the DZN Games Hub. Players follow a short server-generated sequence of left, centre, and right signal pulses. A completed run has twelve pulses and permits up to three misses.

Relay Rush remains unavailable unless both `DZN_GAMES_HUB_ENABLED` and `DZN_GAMES_RELAY_RUSH_ENABLED` are exactly `true`. The Relay Rush switch is deliberately `false` in the production configuration delivered by this source release.

## Security And Fairness

- Discord authentication is required for reads and writes.
- Mutations require same-origin requests and a bounded JSON request body.
- The server generates, stores, schedules, and evaluates each route. The browser receives only the current signal lane.
- The server controls the one-second start delay, 900 ms pulse cadence, input timing, two-minute expiry, miss limit, and optimistic session version.
- A player can read and act only on their own active run. Stale or racing pulses cannot overwrite progress.
- A successful run gives at most one website-only daily reward of 90 XP and 3 parts. Replays remain playable but cannot mint a second reward that day.
- Rewards have no cash value and do not affect paid plans, DayZ statistics, competitive eligibility, rankings, standings, scoring, or match outcomes.
- The new state is tied to the existing DZN account and cascades on account deletion.

## Migration And Activation

Migration `0096_games_hub_relay_rush.sql` is additive. It creates only `dzn_relay_rush_sessions`, `dzn_relay_rush_reward_ledger`, and `idx_dzn_relay_rush_rewards_history`.

Production migration application and feature activation are separate, controlled operations. Activation order:

1. Record a private production D1 recovery bookmark.
2. Confirm the intended database and migration ledger state, including any preceding approved migrations.
3. Apply only `0096_games_hub_relay_rush.sql`.
4. Verify its ledger entry, the two tables, the history index, all CHECK constraints, both foreign keys, and a zero-row baseline.
5. Enable only `DZN_GAMES_RELAY_RUSH_ENABLED` after that verification passes.
6. Run authenticated start, timed pulse, wrong-lane, replay, concurrent-version, daily-reward, account-deletion, Hub-history, Workshop, desktop, and phone checks against the intended environment.
7. Disable the Relay Rush switch if any live verification fails. Do not alter other Games Hub, Discord, payment, or competitive-system controls as part of this operation.

No production database write, feature-switch change, Discord message, payment action, customer charge, Nitrado action, or server restart is part of the source release.

## Local Verification

- `npm run test:games-relay-rush`
- `npm run test:games-relay-rush-production-activation`
- `npm run test:games-hub`
- `npm run qa:games-relay-rush`
- `npm run qa:games-hub`
- `npm run lint -- --max-warnings=0`
- `npm run build`

Rendered QA uses a loopback-only disposable account and local D1 data. It verifies desktop and phone layouts, server-timed input, keyboard controls, browser errors, and horizontal overflow without contacting production services.
