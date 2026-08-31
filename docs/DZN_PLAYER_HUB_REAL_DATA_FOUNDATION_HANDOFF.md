# DZN Player Hub Real-Data Foundation Handoff

Date: 2026-08-31

Branch: `codex/player-hub-real-data-foundation-20260831`

Stacked base: `origin/codex/player-saved-servers-foundation-20260831`

Depends on: PR #125 saved/followed server preference layer

## Scope

This slice turns `/player` from a mostly static entry page into a private real-data Player Hub:

- Adds `GET /api/player/hub`.
- Shows the current player's followed/saved servers from `player_saved_servers`.
- Shows matched cached Discord communities where the current OAuth guild cache supports it.
- Shows public live/upcoming/registration event and tournament suggestions from `competitive_events`.
- Shows private profile entry points for `/player` and `/player/profile`.
- Keeps owner setup routed through `/pricing?intent=owner_setup&returnTo=%2Fsetup`.

No migration is added in this slice. It uses the existing saved-server, Discord guild, linked-server, and event tables.

## Access Contract

`GET /api/player/hub` is private player data:

- Discord login is required.
- Mock auth may bootstrap the mock user in local/test only through the existing mock path.
- Responses are `private, no-store` and `Vary: Cookie`.
- The route is `GET` only.
- The page fetches `/api/player/hub` with credentials and falls back to safe empty/error states.
- Saved-server rows are scoped to the current DZN user.
- Hidden/deleted/merged servers are not shown.
- Private/draft events are not shown.

## Current Discord Matching Boundary

The current Discord cache stores manageable/admin guilds from the OAuth flow through `discord_guilds.owner_user_id`.

That means this slice can truthfully show cached manageable community matches now. It does not yet model every ordinary Discord membership. A later trusted community membership bridge is required before showing non-admin player communities.

## Entitlement And Fairness Matrix

| Surface | Logged-out | Free logged-in player | Starter owner | Pro owner |
| --- | --- | --- | --- | --- |
| `/player` app page | Redirects to login by middleware | Loads Player Hub | Loads Player Hub | Loads Player Hub |
| `GET /api/player/hub` | `401` | Own private hub data only | Own private hub data only | Own private hub data only |
| Followed/saved server panel | Not available | Current user's public saved servers | Current user's public saved servers | Current user's public saved servers |
| Matched communities panel | Not available | Cached current-user Discord matches | Cached current-user Discord matches | Cached current-user Discord matches |
| Suggested events panel | Not available | Public event suggestions only | Public event suggestions only | Public event suggestions only |
| Profile entry points | Login CTA | `/player/profile` private entry | `/player/profile` private entry | `/player/profile` private entry |
| Owner setup CTA | Login/pricing path | `/pricing` then entitlement gate | `/pricing` then entitlement gate | `/pricing` then entitlement gate |
| Competitive systems | No effect | No effect | No effect | No effect |

## Server-Side Boundaries

The Player Hub API may read:

- Current session user.
- Current user's private saved-server rows through the canonical saved-server helper.
- Cached current-user Discord guild rows.
- Public linked-server display fields for matched communities.
- Public live/upcoming/registration event rows.

The Player Hub API must not write, calculate, or mutate:

- billing, Stripe, Store, Supporter Cards, live checkout, or issue `#49`
- owner entitlement, setup, Nitrado, server ownership, or server-management state
- reviews, review scores, replies, reports, or moderation state
- rankings, discovery scores, leaderboard formulas, ADM stats, K/D, kills, deaths, or player profiles
- badges, seasons, crowns, XP awards, calling-card awards, or progression ledgers
- event outcomes, registrations, brackets, CTF scoring, Server Wars scoring, or competitive eligibility

## Validation

Required before merge:

- `npm run test:player-hub-real-data`
- `npm run test:player-saved-servers`
- `npm run test:dzn-player-nav-main-release-candidate`
- `npm run test:public-access-gating`
- `npm run test:events`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- `git diff --check`

Run broader `npm test` if the branch is being prepared for merge/release.

## Manual QA Notes

Expected rendered behavior:

- `/player` shows loading states while auth and hub data resolve.
- Logged-in players see followed servers, matched communities, suggested events, and profile entry points.
- Empty saved/community/event states link to existing player-facing pages.
- Owner setup links to `/pricing?intent=owner_setup&returnTo=%2Fsetup`.
- The page does not expose send/reaction/report chat controls, Store/payment fulfilment, live checkout, Nitrado actions, owner-management actions, or competitive mutations.

## Next Slice

After this stacked PR is reviewed and the saved-server base PR is merged, the next product slice should be:

- Broader player-community matching model: add a trusted, privacy-aware ordinary-member community bridge so non-admin Discord memberships can appear in Player Hub without exposing hidden players, bypassing opt-in public profile controls, or affecting owner workflows, retained exports, billing, rankings, discovery, reviews, badges, seasons, Server Wars, CTF scoring, XP/calling-card awards, or competitive eligibility.
