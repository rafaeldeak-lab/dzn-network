# Progression Award Source Adapters And Audit Handoff

Branch: `codex/verified-activity-adapters-audit-20260825`
Base: `codex/progression-awards-foundation-20260825` at `2c4932931f5f1fb7a2df7513c049b88732d48793`

This slice connects trusted DZN activity sources into the authoritative player progression award queue and adds owner/admin audit visibility for awarded, skipped, failed, progressed, duplicate, and pending source facts. It does not change player access, owner billing, live checkout, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, or competitive eligibility.

## Added

- `migrations/0064_progression_award_source_adapters_audit.sql`
  - Adds source provenance and retry metadata to `player_progression_award_sources`.
  - Tracks `linked_server_id`, `source_table`, `adapter_key`, `attempt_count`, `last_attempted_at`, `retry_count`, and `last_retried_at`.
  - Adds audit/retry indexes for server-scoped owner history and adapter status review.

- `functions/_lib/player-progression.ts`
  - Adds trusted source adapters for:
    - ADM player activity from `player_events`.
    - ADM combat activity from `kill_events`.
    - Owned-server event participation from `server_event_entries`.
    - Approved community activity from `server_reviews`.
  - Adds `collectVerifiedProgressionAwardSources`.
  - Extends `runPlayerProgressionAwardJob` with source collection, adapter allowlisting, failed-row retry scheduling, attempt tracking, and source provenance recording.
  - Keeps all actual XP/calling-card writes behind the existing trusted award processor and existing idempotency rules.

- `functions/api/cron/player-progression/awards.ts`
  - Keeps `POST /api/cron/player-progression/awards` cron-secret-only.
  - Supports bounded `collect_sources`, `adapters`, and `retry_failed` inputs.
  - Defaults to adapter collection when no explicit source list is provided, unless `collect_sources: false` is sent.

- `functions/_lib/player-progression-awards-audit.ts`
  - Adds the shared owner/admin award-source audit reader.
  - Requires canonical owner entitlement for normal owners.
  - Allows configured DZN admins to read global source audit history.
  - Scopes normal owners to source facts tied to their own linked servers.
  - Returns status counts, failed-row retry guidance, and private audit rows without raw evidence blobs or Discord IDs.

- `functions/api/owner/progression/award-audit.ts`
  - Adds `GET /api/owner/progression/award-audit`.
  - Returns private no-store JSON.
  - Rejects `POST`, `PATCH`, `PUT`, and `DELETE`.

- `scripts/test-progression-award-source-adapters-audit.ts`
  - Covers adapter collection, source provenance, award processing, retry scheduling, owner/admin audit scoping, read-only audit routing, private cache headers, and no protected-surface mutations.

## Access Contract

- Free logged-in players can still read/join challenges through `/api/player/challenges`.
- Free logged-in players cannot collect trusted sources, mark sources verified, retry failed source rows, or self-award XP/calling cards.
- `/api/cron/player-progression/awards` is the only source collection, retry, and award execution surface and requires `DZN_CRON_SECRET`.
- `GET /api/owner/progression/award-audit` requires either canonical owner entitlement for own linked-server rows or configured DZN admin access for global rows.
- Starter and Pro unlock owner tooling only. They do not improve or alter player progression outcomes.

## Trusted Source Mapping

| Adapter | Source table | Progression source type | Challenge track | Player mapping |
| --- | --- | --- | --- | --- |
| `adm_player_event` | `player_events` | `adm_gameplay` | `survivor-spark` | `player_events.player_profile_id -> player_profiles.discord_id -> users.discord_id` |
| `adm_kill_event` | `kill_events` | `adm_gameplay` | `arena-rookie` | `kill_events.killer_profile_id -> player_profiles.discord_id -> users.discord_id` |
| `event_entry` | `server_event_entries` | `event_participation` | `community-scout` | `server_event_entries.owner_user_id -> users.id` |
| `approved_review` | `server_reviews` | `community_activity` | `community-scout` | `server_reviews.reviewer_discord_id -> users.discord_id` |

`event_entry` is intentionally owner/server-entry based for this slice because the existing event entry table is server-entry oriented. Future player event RSVP or tournament participant tables can become additional adapters without changing the award processor.

## Mutation Contract

Allowed runtime writes:

- `player_progression_award_sources`
- `player_challenge_participations`
- `player_xp_ledger`
- `player_calling_card_awards`

Allowed trusted reads:

- `player_events`
- `kill_events`
- `server_event_entries`
- `competitive_events`
- `server_reviews`
- `player_profiles`
- `users`
- `linked_servers`

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

Progression remains earned player-side profile progression only. Adapter source facts, retry state, audit history, XP, and calling cards must not affect paid plans, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, server ownership, or competitive eligibility.

Paid owner plans can control owner tools and audit visibility. They cannot grant progression, improve progression odds, change award formulas, or bypass the trusted source and challenge-join requirements.

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

- `npm run test:progression-award-source-adapters-audit`
- `npm run test:progression-awards-foundation`
- `npm run test:challenges-xp-calling-cards-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:reviews-foundation`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:reviews-moderation-workflow-polish`
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

The progression award audit UI slice is now stacked next. After that, the next recommended slice should be the player profile progression showcase: make earned XP, challenge progress, and calling cards more visible from the player profile/Player Hub, with privacy-aware display controls and tests proving profile progression remains earned/player-side only and separate from paid plans, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, and competitive eligibility.
