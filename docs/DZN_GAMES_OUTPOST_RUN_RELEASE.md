# DZN Outpost Run source release

## Scope

This source-only release adds DZN Outpost Run to the authenticated Games Hub. It is an original tactical extraction game: the player crosses a five-by-five fog grid, uses one scanner reading, preserves stamina around hazards, and reaches a server-held emergency relay before the run expires.

The server owns the selected field layout, relay position, hazard positions, player coordinates, visibility, stamina, movement count, scan use, expiry, result, daily reward, Hub history, XP, Workshop parts, and challenge totals. The browser receives only previously entered cells and never the stored layout.

The game adds no paid advantage, server-stat effect, competitive-ranking effect, Discord role change, Discord message, or payment action.

## Security and fairness

- Only a signed-in Discord-linked DZN user may read or mutate their own Outpost Run state.
- POST requests require the same site origin, bounded JSON, an exact action shape, UUID session identity, integer version, and one of four allowed directions.
- The fog view excludes the stored field layout, unreached relay, and unrevealed hazards.
- The server enforces grid bounds, movement interval, scan limit, stamina, move cap, optimistic version checks, expiry, restart cooldown, and a daily reward limit.
- The final extraction movement and reward insert are one D1 batch. A failed reward insert rolls back the winning movement rather than leaving partial progression.
- The migration has foreign keys, constraints, a daily unique reward key, a unique game ID, a reward-history index, and account-deletion cascades.
- Hub reward history, XP, challenges, streaks, and Workshop parts retain earned Outpost Run rewards if the play switch is disabled later.

## Production boundary

`migrations/0099_games_hub_outpost_run.sql` was applied as its own production operation before this source release. Its ledger entry, both tables, reward-history index, constraints, user cascades, and zero-row baseline were verified, including a database-wide foreign-key check.

This release enables only `DZN_GAMES_OUTPOST_RUN_ENABLED` in the production Pages environment. Preview stays disabled. The release does not apply a database migration, create a player session, award XP or parts, or exercise the reward flow.

Future operational checks remain separately controlled: authenticated private-fog visibility, scanner use, route bounds, hazards, retry behavior, daily-reward limits, reward retention with the play switch off, deletion cascades, and mobile rendering.

No Discord invite, role, channel, permission, payment, customer, or production D1 write is part of this source release.

## Local verification

```powershell
npm run test:games-outpost-run
npm run test:games-outpost-run-production-activation
npm run test:games-hub
npm run lint -- --max-warnings=0
npm run build
npm run qa:games-outpost-run
```
