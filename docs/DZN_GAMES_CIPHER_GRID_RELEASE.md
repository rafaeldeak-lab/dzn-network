# DZN Cipher Grid Release

## Scope

Cipher Grid is an original five-letter field-word deduction game in the DZN Games Hub. It adds:

- A touch, keyboard, and desktop-friendly puzzle surface.
- Server-owned private answers, attempts, completion decisions, and daily reward accounting.
- One bounded daily reward of 100 XP and 4 Workshop parts per Discord-authenticated player.
- Hub history, challenges, streaks, and Workshop totals that retain earned Cipher Grid rewards even while play is disabled.
- Private session and reward tables that are removed with an account deletion.

## Security and fairness

- The answer is stored only in D1 and is never included in an API response, browser payload, error, or rendered markup.
- Every write requires a current authenticated Discord session, same-origin POST, a bounded JSON body, an exact request shape, a current optimistic version, and an unexpired player-owned session.
- Duplicate letters use two-pass server scoring, so a guess cannot claim more copies of a letter than the private answer contains.
- The completion update and daily reward insertion are one atomic D1 batch. A stale or failed completion cannot mint a reward.
- The daily ledger has unique user/day and game-session constraints. The browser never supplies XP, parts, the answer, or a reward key.
- This game is noncompetitive: it does not alter standings, ranking, eligibility, scoring formulas, server ownership, billing, or Discord membership.

## Activation boundary

The Cipher Grid D1 schema was previously applied and independently verified in production. This release enables only the following existing Pages production flag:

```text
DZN_GAMES_CIPHER_GRID_ENABLED=true
```

It does not apply a D1 migration, alter any Discord role or invite, change payments, or modify player progress outside normal authenticated game play.

## Completed production preflight

The production database was checked before this activation:

1. `0097_games_hub_cipher_grid.sql` appears exactly once in the migration ledger.
2. The session and reward-ledger tables, reward-history index, `CHECK` constraints, and cascading foreign keys match the migration.
3. Both Cipher Grid tables have a zero-row baseline and `PRAGMA foreign_key_check` passed.
4. The Games Hub feature flag was enabled only after the schema preflight passed.
5. A read-only production load check must complete before an authenticated player starts a puzzle. The answer must not appear in browser payloads, page source, logs, or error responses.

## Local verification

```text
npm run test:games-cipher-grid
npm run test:games-cipher-grid-production-activation
npm run test:games-hub
npm run qa:games-cipher-grid
npm run lint -- --max-warnings=0
npm run build
```
