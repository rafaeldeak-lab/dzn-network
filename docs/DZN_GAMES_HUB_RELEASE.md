# DZN Games Hub: First Playable Release

## Scope and Source

The user's shared Mini Game Ideas conversation and attached DZN mockups are the product references:
https://chatgpt.com/share/6aa5adde-2070-83ed-8b35-5378cb3f7c21

The latest requirement makes website games available to every Discord-signed-in player, not just Pro server owners. This supersedes the earlier Pro-only games proposal. References are inspiration, not evidence of implemented features or permission to publish fabricated ranks, online counts or rewards.

This release implements `/games` with DZN Minesweeper, Recon/Patrol/Survival difficulties, saved boards, touch flags, keyboard controls, daily earned website XP and parts, six original insignia, a three-stage field-relay workshop, prestige counts, and personal reward history. It is not the complete multi-game lobby.

## Rules and Boundaries

- Existing Discord sessions are required for every API read and write. No server ownership, paid subscription or plan gate is added. No mock-auth bypass exists in the production handler.
- A game lasts 30 minutes. The first reveal is safe. Revealing all safe cells wins; correct flags alone do not award a win. Every move is evaluated on the server, using `@taros-minesweeper/lib` 1.1.2 (ISC).
- Board state stays server-side. The client receives only revealed adjacent counts and player flags while playing. The adapter preserves flagged cells during engine flood-fill and uses the all-safe-cells win rule rather than the library's all-cells-revealed helper.
- Each difficulty rewards once per UTC day: Recon 50 XP/1 part, Patrol 100 XP/2 parts, Survival 150 XP/3 parts. Maximum 300 XP/6 parts per day. Further wins are practice.
- XP and parts are not purchasable, transferable, redeemable, or usable for DayZ statistics, competitive ranking, paid plans, billing credit or cash.
- Every 12 earned parts builds one assembly. Three assemblies complete a relay and increment prestige. XP and completed projects survive a missed day. Streaks count consecutive days with an earned game reward, allowing yesterday's streak to continue today.
- Server-controlled time, owner-scoped session reads, compare-and-swap moves, an atomic win/reward transaction, daily uniqueness and idempotent workshop request IDs prevent stale writes and duplicate rewards. No client-supplied score or reward amount is trusted.
- One current board per player bounds session storage. Starting another board is limited to once per five seconds; board versions are capped at 2,000. This is not a claim of bot-proof competitive play. Ranked PvP needs separate anti-automation rules and controls.
- New artwork is original generated media, not copied competitor game art. The supplied mockups are not embedded as a fake playable screen.

## Release Gates

Migration `0070_games_hub.sql` is additive and isolated. It has not been applied to production by this work. It creates only `dzn_game_sessions` and `dzn_game_reward_ledger`, both linked to existing users. No existing billing, DayZ stats, identity association, Nitrado, reset schedule or Discord record is updated.

The API is closed unless `DZN_GAMES_HUB_ENABLED` is exactly `true`. The default is disabled. Missing schema fails closed with a sanitized unavailable response. Merging source is not a production migration or feature activation.

Before live activation: review the immutable patch; check the current migration ledger; apply only this approved migration separately; verify the new tables and foreign keys; enable the scoped flag; verify a genuine Free Discord account can play and earn once; verify a second account cannot read or move its board; verify mobile rendering and monitoring. Reverting the flag disables access without deleting rewards.

There is no paid spin, checkout, new payment method, customer charge, public chat posting or external-service mutation in this release.

## Local Verification

- `npm run test:games-hub` covers auth, origin protection, missing schema, hidden boards, account isolation, invalid/forged inputs, engine behavior, reward caps, stale-write races, rollback, workshop idempotency, streaks and real local workerd/D1 semantics.
- `npm run dev:games-hub` serves an existing production export on loopback only. Its `/__local-login` creates a disposable synthetic session in an in-memory database; it never contacts Discord or production. Closing the process discards that preview data. No local-preview path is included in Pages functions.
- `GAMES_PREVIEW_URL=http://127.0.0.1:<port>` with `node scripts/qa-games-hub.mjs` checks the actual UI/API at desktop, tablet and phone sizes. Tests use a synthetic account, not the owner's real account.
- Full repository tests, typechecking, lint, build and audit remain required. Screenshots and run outputs belong in the task's local output directory, not in production assets.

## Retained Games and Platform Backlog

1. DZN Trivia: original question bank, repeat-safe server validation, difficulty rules and earned rewards.
2. DZN Word Chain: shared turns, real-word validation, duplicate detection and moderated global chat. No chat messages are sent by this release.
3. DZN Hide & Seek: original DZN scenes, fair item placement, accessible input and server-validated claims.
4. DZN Coin Flip / spin wheel: settle a non-cash, non-staked design before implementation. Paid random outcomes remain excluded; a cooldown is not treated as compliance clearance.
5. Multi-game lobby, mission categories, equipment collections, challenges and opt-in PvP/community events. No purchased competitive advantage, fabricated population or fake leaderboard.
6. Global chat: authenticated membership, rate limits, mute/report/block, moderation, retention and audited platform-owner oversight before publication.
7. Platform-owner support views over website-game reward and assembly history, purpose-limited access, reasoned corrections and immutable audit trails. Personal history is implemented; cross-account support controls are not.
8. Existing NukeTown exact-server Pro exception rollout, Nitrado automatic import proof, preserved bot reset schedule, stale dashboard details, FED & FERAL recovery, genuine game-account linking, customer billing verification and Comms/support work remain separate. No new completion claim is made for them here.
9. Chernarus/Livonia/Sakhal maps, remaining badge surfaces and gameplay XP stay separate from website-game XP. Correct map assets and usage rights still need verification.
