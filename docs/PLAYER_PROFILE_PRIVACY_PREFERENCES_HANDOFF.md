# Player Profile Privacy Preferences Handoff

## Scope

This slice adds persistent player profile privacy preferences for the free logged-in player profile surface. It saves player-owned display choices for public profile visibility and per-section profile progression display, then hydrates those choices into the existing `/player/profile` showcase.

This is not a public profile publishing slice, not an owner monetisation slice, and not a competitive progression-award slice.

## Branch And Base

- Branch: `codex/player-profile-privacy-preferences-20260825`
- Base branch: `codex/player-profile-progression-showcase-20260825`
- Base commit: `33aaeea54498275283e6e87bfefcb8137792c57c`

## Added Surfaces

- `player_profile_privacy_preferences`
  - Additive D1 table keyed by the authenticated player's internal `users.id`.
  - Stores public profile visibility and display toggles for XP, challenge progress, calling cards, and award dates.
  - Keeps Discord identity and source-detail display forced off until a later public-profile reader slice defines a safe publication contract.

- `GET /api/player/profile-privacy`
  - Free logged-in player settings read API.
  - Requires `getRequestSessionUser`.
  - Returns private no-store JSON.
  - Returns safe defaults if no saved row exists.
  - Does not require owner entitlement, Starter, Pro, server ownership, Nitrado, Stripe, Discord bot permissions, or billing state.

- `PATCH /api/player/profile-privacy`
  - Free logged-in player settings write API.
  - Uses bounded JSON parsing.
  - Writes only the authenticated player's own `player_profile_privacy_preferences` row.
  - Ignores request-body `user_id`, `discord_id`, ownership, server, plan, or billing values as authority sources.
  - Rejects logged-out users and rejects methods other than `GET` and `PATCH`.

- `/api/player/profile`
  - Hydrates the authenticated player's saved privacy preferences into the existing private profile progression payload.
  - Remains `GET` only and read-only.

- `/player/profile`
  - Adds persistent save behavior to the existing privacy display controls.
  - Keeps public, private, and hidden preview modes as display states only.

## Privacy Contract

No public profile reader route is introduced in this slice.

Saved settings may indicate whether a player's profile should be public in a later publishing slice, but this slice does not expose a public profile URL or public reader API.

The private settings API and profile payload must not expose:

- Discord IDs.
- Internal user IDs.
- Source IDs.
- Raw evidence blobs.
- ADM source rows.
- Billing rows or owner account state.
- Nitrado tokens.
- Discord bot tokens.
- Stripe state.
- Exact award timestamps in public-safe preview mode.

## Fairness And Isolation

Profile privacy preferences are player-owned presentation settings only. They must not affect:

- Billing.
- Rankings.
- Discovery.
- Reviews or review score.
- Badges.
- Seasons.
- Events.
- Server Wars scoring.
- XP awards.
- Calling-card awards.
- Competitive eligibility.

The privacy settings helper and API must not become dependencies of ranking, discovery, review, badge, season, event, Server Wars, XP-award, calling-card-award, billing, checkout, Nitrado, Discord, or owner entitlement systems.

## Production Safety

This slice does not:

- Enable live checkout.
- Change `DZN_LIVE_CHECKOUT_ENABLED`.
- Create checkout sessions.
- Create or mutate Stripe products, prices, sessions, or webhooks.
- No Stripe products/prices were created or changed.
- Change Cloudflare secrets.
- Mutate production D1.
- Call Nitrado.
- Send Discord bot messages or mutate Discord resources.
- Apply production migrations.
- Merge issue #49.

Issue #49 remains reserved for final live checkout activation.

## Validation Evidence

- `npm run test:player-profile-privacy-preferences`
- `npm run test:player-profile-progression-showcase`
- `npm run test:challenges-xp-calling-cards-foundation`
- `npm run test:progression-awards-foundation`
- `npm run test:progression-award-source-adapters-audit`
- `npm run test:progression-award-audit-ui`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:reviews-foundation`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:review-notification-read-state`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`

The final validation pass completed successfully on this slice. `npm run lint` passed with warnings only: the existing `<img>` warnings in `components/network/public-network.tsx` and `components/servers/live-server-rail.tsx`, plus the existing unused `_linkedServerId` warning in `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`.

`npm run check:billing-config` remained read-only and confirmed live checkout is disabled, checkout session creation is not allowed, and live Stripe secrets/prices are not configured locally.

Rendered preview checks covered `/player/profile` on desktop, mid-width, and mobile viewports. The saved privacy-preference controls were visible at all tested widths, there was no horizontal overflow, and no browser console errors were reported. Direct Next.js local preview does not serve Cloudflare Pages Functions, so API behavior was validated through function tests.

## Next Recommended Slice

Next should be the public profile reader contract slice: define the safe public read shape for opted-in player profiles, expose only redacted section data according to saved player preferences, and keep proving profile publication does not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
