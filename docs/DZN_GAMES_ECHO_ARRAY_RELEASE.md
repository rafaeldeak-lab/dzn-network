# DZN Echo Array activation release

## Scope

This source-only release adds Echo Array to the authenticated DZN Games Hub. It is an original three-stage tactical memory game: a player watches a short node sequence, then repeats it after the cue closes. The server owns the session, stage sequence, retries, timing, result, daily reward, Hub history, XP, Workshop parts, and challenge totals.

The game adds no paid advantage, server-stat effect, competitive-ranking effect, Discord role change, Discord message, payment action, or production configuration change.

## Security and fairness

- Only a signed-in Discord-linked DZN user may read or mutate their own Echo Array session.
- POST requests require the same site origin, a bounded JSON body, an exact action shape, UUID session identity, integer version, and one of the four allowed nodes.
- A cue is visible only while it is intentionally playing. Once the reveal window closes, normal reads do not include the stored pattern.
- The server enforces the cue duration, input rate, stage ordering, optimistic version check, two-error limit, expiry, restart cooldown, and one reward per user per UTC day.
- The final input update and reward insert are one D1 batch. A failed reward insert rolls back the winning input rather than leaving partial progression.
- The migration uses foreign keys, constraints, a daily unique reward key, a unique game ID, and account-deletion cascades.
- Hub reward history, XP, challenges, streaks, and Workshop parts retain previously earned Echo Array rewards even when its play switch is disabled later.

## Activation boundary

`migrations/0098_games_hub_echo_array.sql` was previously applied and independently verified in production. This release enables only `DZN_GAMES_ECHO_ARRAY_ENABLED=true` in the Pages production configuration.

The release does not apply a D1 migration, alter Discord access, change payment settings, or create player progress outside normal authenticated game play.

## Completed production preflight

1. `0098_games_hub_echo_array.sql` appears exactly once in the production migration ledger.
2. The session and reward-ledger tables, reward-history index, constraints, and cascading foreign keys match the approved migration.
3. Both Echo Array tables have a zero-row baseline and `PRAGMA foreign_key_check` passed.
4. A read-only authenticated production panel load is required after deployment. It must not begin a session or reveal a private sequence.

## Local verification

```powershell
npm run test:games-echo-array
npm run test:games-echo-array-production-activation
npm run test:games-hub
npm run lint -- --max-warnings=0
npm run build
npm run qa:games-echo-array
```
