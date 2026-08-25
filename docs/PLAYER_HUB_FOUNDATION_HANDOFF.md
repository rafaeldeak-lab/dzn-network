# DZN Player Hub Foundation Handoff

## Scope

This slice is stacked on the Player vs Owner Access Foundation PR. It adds the first logged-in Player Hub surface without changing live checkout, production D1, Stripe, Nitrado, Discord, owner billing products, or competitive scoring.

## Branching

- Base dependency: `codex/player-owner-access-foundation-20260825` / PR #50.
- Slice branch: `codex/player-hub-foundation-20260825`.
- Production merge/deploy/payment activation: not included.

## Product Contract

`/player` is a free logged-in player home. It is protected by session login but not by owner billing entitlement.

The hub shows:

- Matched Discord communities.
- Followed/saved servers.
- Suggested servers.
- Suggested public events and tournaments.
- Profile entry points for player/community surfaces.
- Owner setup entry that routes through `/pricing?intent=owner_setup&returnTo=%2Fsetup`.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active/effective Pro |
| --- | --- | --- | --- | --- |
| `/player` | Login redirect | Allowed | Allowed | Allowed |
| `/api/player/hub` | 401 | Allowed | Allowed | Allowed |
| `/api/player/communities` | 401 | Allowed | Allowed | Allowed |
| `/pricing` | Allowed | Allowed | Allowed | Allowed |
| `/setup` | Login redirect | Pricing redirect | Allowed | Allowed |
| `/api/onboarding/*` and `/api/nitrado/*` | 401 | 402 owner plan required | Allowed after existing checks | Allowed after existing checks |

## Implementation Notes

- `functions/api/player/hub.ts` reads the current session with `getRequestSessionUser`.
- The hub endpoint reuses `getPlayerCommunitiesPayload` and normalizes matched community servers into safe player links.
- Saved/followed server preference storage is additive in `migrations/0060_player_hub_foundation.sql` as `player_saved_servers`.
- Saved/followed state is player preference data only. It must not affect leaderboard rank, server score, event scoring, badges, XP, reviews, or matchmaking outcomes.
- The hub endpoint is read-only in this slice; save/follow mutation controls are intentionally reserved for a later player-preference slice.

## Production Safety

This slice must not:

- Set `DZN_LIVE_CHECKOUT_ENABLED=true`.
- Create or mutate live Stripe products, prices, subscriptions, customers, checkout sessions, or webhooks.
- Apply production D1 migrations.
- Mutate Nitrado services or tokens.
- Mutate Discord guild records, bot settings, channels, embeds, or owner permissions.
- Merge issue/PR #49.

## Validation Checklist

- `git diff --check`
- `npm run test:player-hub-foundation`
- `npm run test:player-owner-access-foundation`
- `npm run test:public-access-gating`
- `npm run test:nav-access-visibility`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- Render `/player` locally after build and inspect desktop/mobile screenshots.
