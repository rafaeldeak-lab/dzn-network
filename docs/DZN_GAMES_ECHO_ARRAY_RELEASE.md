# DZN Echo Array source release

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

## Production boundary

`migrations/0098_games_hub_echo_array.sql` is additive and intentionally unapplied. `DZN_GAMES_ECHO_ARRAY_ENABLED` is explicitly `false` in the production configuration. The local preview enables the switch only against an in-memory synthetic database.

Future production activation must remain a separate controlled operation:

1. Capture the approved recovery point.
2. Apply only `0098_games_hub_echo_array.sql`.
3. Verify the migration ledger, both tables, reward-history index, constraints, foreign keys, and zero-row baseline.
4. Enable only `DZN_GAMES_ECHO_ARRAY_ENABLED` after that verification.
5. Run authenticated production smoke checks for private ownership, cue timing, retries, one daily reward, reward retention with the play switch off, deletion cascade, and mobile rendering.

No Discord invite, role, channel, permission, payment, customer, deployment, or production D1 change is part of this source release.

## Local verification

```powershell
npm run test:games-echo-array
npm run test:games-echo-array-production-activation
npm run test:games-hub
npm run lint -- --max-warnings=0
npm run build
npm run qa:games-echo-array
```
