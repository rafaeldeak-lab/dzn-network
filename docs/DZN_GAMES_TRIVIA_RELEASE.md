# DZN Trivia Release

## Scope

This release adds DZN Trivia as the second playable title inside the existing Games Hub. It includes an original server-side question bank, three difficulties, five-question rounds, a four-answer pass threshold, saved round state, daily website XP and parts, shared Hub balances, activity history, and workshop spending.

Trivia remains unavailable unless both `DZN_GAMES_HUB_ENABLED` and `DZN_GAMES_TRIVIA_ENABLED` are exactly `true`. The new Trivia switch is not enabled by this release.

## Security And Fairness

- Discord authentication is required for reads and writes.
- Mutations require a same-origin request and a bounded JSON body.
- Question selection, answer checking, score calculation and rewards are server-controlled.
- Only the current prompt and shuffled choices are returned. Correct answers, future questions and stored question IDs are not returned.
- Versioned updates reject stale or replayed answers. A user cannot read or answer another user's round.
- A round expires after 15 minutes. Starting replacement rounds is rate-limited.
- Passing requires at least four correct answers. Each difficulty rewards at most once per UTC day.
- Rewards are website-only and have no cash value, paid-plan benefit, DayZ-stat effect or competitive-ranking effect.

## Migration And Activation

Migration `0085_games_hub_trivia.sql` is additive and creates only `dzn_trivia_sessions`, `dzn_trivia_reward_ledger`, and its history index. Production migration application is a separate controlled operation.

Activation order:

1. Record a production D1 recovery bookmark.
2. Apply only migration `0085_games_hub_trivia.sql`.
3. Verify its migration-ledger entry, both tables, the history index, constraints, foreign keys and zero-row baseline.
4. Enable only `DZN_GAMES_TRIVIA_ENABLED` after schema verification.
5. Run authenticated start, answer, replay, account-isolation, expiry, daily-reward and workshop-spend checks.
6. Disable the Trivia switch if any live verification fails.

No production database write, feature-switch change, external message, payment action, customer charge, Nitrado action or server restart is part of the source release.

## Verification

- `npm run test:games-hub`
- `npm run qa:games-trivia`
- `npm run lint`
- `npm run build`

The rendered QA uses a loopback-only disposable account and database. It verifies desktop and phone layouts, saved-round resume behavior, answer submission, browser errors and horizontal overflow without contacting production services.
