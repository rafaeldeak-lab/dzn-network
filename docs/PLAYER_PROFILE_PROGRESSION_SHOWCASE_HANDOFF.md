# Player Profile Progression Showcase Handoff

## Scope

This slice adds a free logged-in player profile progression showcase. It makes earned XP, challenge progress, calling cards, and a compact progression timeline easier to see from the Player Hub and from a dedicated profile page.

This is not a public profile publishing slice and it is not an owner monetisation slice.

## Branch And Base

- Branch: `codex/player-profile-progression-showcase-20260825`
- Base branch: `codex/progression-award-audit-ui-20260825`
- Base commit: `9012639a56ce52bcd316036c78622ef459d7b10d`

## Added Surfaces

- `/player/profile`
  - Free logged-in player page.
  - Shows earned XP, challenge progress, earned calling cards, and progression timeline.
  - Includes local privacy display controls for private view, public-safe preview, and hidden preview.

- `GET /api/player/profile`
  - Free logged-in player API.
  - Requires `getRequestSessionUser`.
  - Returns private no-store JSON.
  - Uses the existing player challenge/progression read model.
  - Does not accept write methods.

- `/player`
  - Adds a prominent Player Profile Progression Showcase panel.
  - Links to `/player/profile`.
  - Keeps Add Server behind `/pricing?intent=owner_setup&returnTo=%2Fsetup`.

## Privacy Contract

Public profile publishing remains off in this slice. The page controls are preview-only local UI state until a later profile settings slice persists display choices.

The profile payload is scoped to the authenticated viewer and may expose:

- Display name.
- Avatar URL.
- Total earned XP.
- Joined/completed challenge counts.
- Challenge progress summaries.
- Earned calling-card summaries.
- Coarse progression timeline rows.

The profile payload and public-safe preview must not expose:

- Discord IDs.
- Internal user IDs.
- Source IDs.
- Raw evidence blobs.
- ADM source rows.
- Billing rows or owner account state.
- Nitrado tokens.
- Discord bot tokens.
- Stripe state.

## Fairness And Isolation

Profile progression remains earned player-side display only. It must not affect:

- Paid plans.
- Rankings.
- Discovery score.
- Reviews or review score.
- Badges.
- Seasons.
- Events.
- Server Wars scoring.
- Server ownership.
- XP awards.
- Calling-card awards.
- Competitive eligibility.

## Production Safety

This slice does not:

- Enable live checkout.
- Change `DZN_LIVE_CHECKOUT_ENABLED`.
- Create or mutate Stripe products, prices, sessions, or webhooks.
- No Stripe products/prices were created or changed.
- Change Cloudflare secrets or production D1 rows.
- Call Nitrado.
- Send Discord bot messages or mutate Discord resources.
- Apply production migrations.
- Merge issue #49.

Issue #49 remains reserved for final live checkout activation.

## Validation

- `npm run test:player-profile-progression-showcase` passed.
- Affected progression/player/access/billing/review/event/competitive checks passed during the slice validation pass.
- `npm test` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with warnings only. Source warnings were pre-existing `<img>` warnings in `components/network/public-network.tsx` and `components/servers/live-server-rail.tsx`, plus the existing `_linkedServerId` unused warning in `functions/api/servers/[serverId]/dashboard/advanced-stats.ts`. Generated `.wrangler` preview bundles also emitted warnings and were not staged.
- `npm run check:billing-config` passed as a read-only safety check and confirmed live checkout is disabled, checkout creation is not allowed, and live Stripe secrets/prices are not configured locally.
- `npm run build` passed and generated the `/player/profile` route.
- `git diff --check` passed.
- Codex Security diff scan `91bb2eea-0305-4226-bd35-d9175a8bcfb7` completed with 0 findings and complete coverage of the changed executable files.

Rendered local preview checks covered `/player/profile` and `/player` on desktop, mid-width, and mobile viewports. The profile privacy mode controls were exercised for Private, Public Preview, and Hidden Preview states. Direct Next.js local preview does not serve Cloudflare Pages Functions, so API data rendering was validated through the function tests rather than the local Next server.

## Next Recommended Slice

Next should be persistent player profile privacy preferences: add a small player-owned settings model for public profile visibility and per-section display preferences, expose it through a private player settings API, and keep proving profile display choices do not affect billing, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
