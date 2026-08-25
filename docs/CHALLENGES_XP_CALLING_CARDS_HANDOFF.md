# Challenges / XP / Calling Cards Foundation Handoff

This slice adds the first free logged-in player feature for challenge participation and player-side progression. It creates the safe structure for earned XP and calling cards while keeping owner setup, paid plans, rankings, discovery, reviews, events, badges, seasons, and Server Wars scoring untouched.

## Branch

- Branch: `codex/challenges-xp-calling-cards-foundation-20260825`
- Base: `origin/codex/review-notification-read-state-20260825`
- Production merge/deploy/migration application: not included.

## Added

- `migrations/0062_player_challenges_xp_calling_cards.sql`
  - Adds `player_challenges`.
  - Adds `player_challenge_participations`.
  - Adds `player_xp_ledger`.
  - Adds `player_calling_cards`.
  - Adds `player_calling_card_awards`.
  - Seeds foundation challenge and calling-card catalog rows only.

- `functions/_lib/player-progression.ts`
  - Builds the player challenge payload.
  - Reads private participation state for the authenticated player.
  - Reads earned XP and calling-card award hooks.
  - Saves player challenge joins only to `player_challenge_participations`.

- `functions/api/player/challenges.ts`
  - `GET` returns challenge catalog, private player state, XP summary, and calling cards.
  - `POST` joins an active challenge for the authenticated player.

- Player UI
  - `/events/challenges` now shows a free player progression panel with join buttons.
  - `/player` now shows challenge/XP/calling-card progress and profile entry points.

## Access Contract

- Logged-out users receive `401` from `/api/player/challenges`.
- Free logged-in Discord players can read and join player challenges.
- Starter and Pro users can use the same player surface because they are players first.
- The endpoint does not call owner entitlement helpers and does not require server ownership.
- Owner setup remains behind `/pricing?intent=owner_setup&returnTo=%2Fsetup` and the canonical owner entitlement boundary.

## Mutation Contract

The player self-join action writes only:

- `player_challenge_participations`

The slice does not write:

- `player_xp_ledger`
- `player_calling_card_awards`
- billing or subscription tables
- server ownership tables
- rankings or discovery tables
- review tables
- event/tournament tables
- Server Wars tables
- badge or season tables
- ADM/stat tables such as `player_profiles`, `kill_events`, or `player_events`

XP ledger and calling-card award tables are intentionally hooks for later verified progression engines. A normal player joining a challenge must not self-award XP or calling cards.

## Fairness

Challenge participation, XP, and calling cards are player-side progression only. They must not affect paid plans, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, profile competitive eligibility, or server competitive eligibility.

## Live Payment And Production Safety

- `DZN_LIVE_CHECKOUT_ENABLED` remains disabled.
- Stripe products/prices are not mutated.
- Cloudflare secrets are not changed.
- Production D1 is not written or migrated in this slice.
- Nitrado is not called.
- Discord bot delivery or guild mutation is not called.
- Issue #49 remains reserved for final live checkout activation.

## Validation

Primary focused test:

```text
npm run test:challenges-xp-calling-cards-foundation
```

Relevant surrounding validation:

```text
npm run test:player-hub-foundation
npm run test:player-saved-servers
npm run test:reviews-foundation
npm run test:review-notification-read-state
npm run test:events
npm run test:dzn-pulse
npm run test:billing-plans
npm run test:stripe-live-readiness
npm run test:stripe-live-activation-checklist
npm run test:server-war-scoring
npm run test:server-war-gating
npm run check:billing-config
npx tsc --noEmit --incremental false
npm run lint
npm run build
git diff --check
```

## Next Recommended Slice

The next slice should be the verified progression award engine: connect challenge completion to trusted gameplay/community evidence, write XP ledger and calling-card awards from server-side rules only, expose safe profile display, and keep every fairness test proving progression remains separate from billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, and competitive eligibility.
