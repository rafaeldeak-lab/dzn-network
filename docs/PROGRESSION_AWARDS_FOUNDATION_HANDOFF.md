# Progression Awards Foundation Handoff

Branch: `codex/progression-awards-foundation-20260825`
Base: `codex/challenges-xp-calling-cards-foundation-20260825` at `9de0606373fb9c6b51ddea87e5abd1d564d861e2`

This slice adds the authoritative progression award foundation for DZN player challenges. It lets trusted server-side jobs turn verified DZN activity facts into earned XP and calling cards while keeping normal player access free and preventing player/browser self-awards.

## Added

- `migrations/0063_player_progression_award_sources.sql`
  - Adds `player_progression_award_sources`.
  - Stores verified source facts for player progression.
  - Dedupes each player/source pair with `UNIQUE(user_id, source_type, source_id)`.
  - Tracks pending, progressed, awarded, duplicate, skipped, and failed processing states.

- `functions/_lib/player-progression.ts`
  - Adds `runPlayerProgressionAwardJob`.
  - Accepts only explicitly verified source facts from trusted job callers.
  - Supports source types: `adm_gameplay`, `challenge_rule`, `community_activity`, `event_participation`, and `verified_activity`.
  - Resolves active challenges from the challenge catalog.
  - Requires the player to have already joined the challenge.
  - Updates participation progress/completion.
  - Writes XP to `player_xp_ledger` with a `challenge_completion` source key.
  - Writes calling-card awards to `player_calling_card_awards` with the same `challenge_completion` source key.
  - Uses idempotent insert behavior so repeated source facts or repeated completion jobs do not duplicate XP or cards.

- `functions/api/cron/player-progression/awards.ts`
  - Adds `POST /api/cron/player-progression/awards`.
  - Requires `requireCronSecret`.
  - Rejects normal browser/session access.
  - Accepts optional bounded `verified_sources` or `sources` arrays.
  - Processes pending verified source rows in small batches.

- `components/events/events-platform.tsx`
  - Clarifies that XP/calling cards unlock from verified DZN activity only.

- `components/player/player-hub-page.tsx`
  - Clarifies that profile progress and calling cards come from verified DZN activity.

## Access Contract

- Free logged-in players can still read and join player challenges through `/api/player/challenges`.
- Free logged-in players cannot complete a challenge, award XP, award a calling card, submit trusted evidence, or run the award job.
- Starter and Pro do not unlock player progression advantages.
- Owner entitlement, server ownership, Stripe, Nitrado, Discord bot permissions, and live checkout are not part of progression awards.
- The only new award execution surface is the cron-secret-protected job route.

## Mutation Contract

Allowed runtime writes:

- `player_progression_award_sources`
- `player_challenge_participations`
- `player_xp_ledger`
- `player_calling_card_awards`

Forbidden runtime writes:

- owner billing tables
- server ownership tables
- rankings or leaderboards
- discovery scoring
- reviews or review score
- badges
- seasons
- events/tournaments
- Server Wars scoring/results
- Nitrado state
- Discord bot delivery
- Cloudflare secrets
- Stripe checkout/products/prices

## Fairness

Progression awards are earned player-side profile progression only. They must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

The protected award job derives XP/calling-card rewards from the player challenge catalog, not from browser input or paid plan state.

## Production Safety

- `DZN_LIVE_CHECKOUT_ENABLED` remains disabled.
- No Stripe products/prices were created or changed.
- No Cloudflare secrets were created or changed.
- No production D1 migration was applied.
- No Nitrado mutation was performed.
- No Discord mutation was performed.
- Issue #49 remains reserved for final live checkout activation.
- Production merge/deploy/migration application: not included.

## Validation

Run before PR handoff:

- `npm run test:progression-awards-foundation`
- `npm run test:challenges-xp-calling-cards-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:reviews-foundation`
- `npm run test:review-notification-read-state`
- `npm run test:public-access-gating`
- `npm run test:nav-access-visibility`
- `npm run test:player-owner-access-foundation`
- `npm run test:public-leaderboards`
- `npm run test:reputation-platform`
- `npm run test:badge-awards`
- `npm run test:badge-evaluation`
- `npm run test:dzn-seasons`
- `npm run test:events`
- `npm run test:server-war-scoring`
- `npm run test:server-war-gating`
- `npm run test:server-wars`
- `npm run test:server-war-automation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Next Slice

Next should be the verified source integration slice: connect real trusted activity producers such as ADM-derived gameplay milestones, event participation confirmations, and community activity checks into `player_progression_award_sources`, while keeping all award execution cron-secret-protected and all player progression separate from billing and competitive systems.
