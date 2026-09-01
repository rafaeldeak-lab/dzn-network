# DZN Player Community Refresh/Status Handoff

Date: 2026-09-01

Branch: `codex/player-community-refresh-status-20260901`

Base: `origin/main` after PR `#128` release (`f606c042633f5532cb971ced99beb4131a726349`).

## Scope

This slice adds clearer Discord membership refresh/status UX for the free logged-in Player Hub.

- Adds a shared Discord OAuth token helper used by the existing guild refresh route and the new player membership refresh route.
- Adds `POST /api/player/community-memberships/refresh` for same-origin, authenticated, current-user membership refreshes.
- Updates `/api/player/hub` to return a private `discord_membership_status` contract.
- Updates `/player` matched-community UI with last-check copy, refresh progress, success/error states, and Discord reconnect guidance.
- Adds `npm run test:player-community-refresh-status`.

## Runtime Boundaries

The new refresh route writes only the current user's `player_discord_community_memberships` rows after reading the current user's Discord OAuth guild list.

It does not:

- Return raw Discord guild lists.
- Return Discord permission bits.
- Return other-user membership rows.
- Update the owner/setup `discord_guilds` cache.
- Grant owner access or setup authority.
- Create public profile handles or visibility changes.
- Add migrations or production D1 changes.
- Touch billing, Store/payment, live checkout, Stripe, Cloudflare secrets/config, Nitrado, Discord posting, analytics/tracking, retained exports, moderation, AI, Durable Objects, WebSockets, or issue `#49`.

The existing `/api/discord/guilds?fresh=1` route remains the owner/setup route that can update manageable guild cache rows for owner onboarding.

## Privacy And Fairness Boundary

- Membership refresh is private to the current logged-in player.
- `/api/player/hub` remains `GET` only and private no-store.
- `/api/player/community-memberships/refresh` is `POST` only, same-origin guarded, and private no-store.
- Hidden, unmatched, revoked, and other-user communities remain hidden from the Hub.
- Owner setup still starts at `/pricing?intent=owner_setup&returnTo=%2Fsetup` and remains behind the canonical entitlement gate.
- Billing, rankings, discovery score, reviews, events, badges, seasons, Server Wars, CTF scoring, XP awards, calling-card awards, public profile visibility, and competitive eligibility stay isolated.

## Validation

Run before PR/release:

- `npm run test:player-community-refresh-status`
- `npm run test:player-community-matching-ui`
- `npm run test:player-community-matching`
- `npm run test:player-hub-real-data`
- `npm run test:discord-guilds`
- `npm run test:public-access-gating`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- `npm test`
- `git diff --check`

## Expected Manual QA

- Logged-out `/player` users still see the free Player Hub login prompt.
- Logged-in `/player` users see the matched-community panel with Discord membership status copy.
- Refresh button enters a checking state and returns success without showing raw private guilds.
- Missing or expired Discord guild permission shows a reconnect message.
- If the refresh route is unavailable, the panel keeps the existing Hub data and shows an error state.
- Owner setup, billing, and competitive pages remain unchanged.

## Next Slice

Recommended next product slice:

- Player Hub suggested event/tournament relevance polish: prioritise public events connected to followed servers and privately matched communities, while keeping suggestions presentation-only and isolated from scoring, eligibility, billing, owner workflows, progression, reviews, rankings, and discovery formulas.
