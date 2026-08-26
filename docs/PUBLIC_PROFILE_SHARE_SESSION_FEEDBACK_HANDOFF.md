# Public Profile Share Session Feedback Handoff

Branch: `codex/public-profile-share-session-feedback-20260826`

Base branch: `codex/public-profile-owner-preview-share-polish-20260826`

Base commit: `95445e18261222dce71d8f9bde07713282bef8f7`

## Scope

This slice adds analytics-free and audit-free public profile share feedback to the private logged-in `/player/profile` share panel.

It lets players see what they last did with their generated public profile link during the current browser tab session only. The feedback disappears on reload, navigation, tab close, or component remount.

There is no stored share history, no tracking events, and no analytics calls in this slice.

## Implementation

- `components/player/public-profile-share-panel.tsx`
  - Adds `ShareActivityKind` and `ShareActivityRecord`.
  - Stores share feedback in component `useState` only.
  - Records local timestamps for:
    - Opening the public profile page.
    - Copying the full public profile link.
    - Copying the generated public handle.
    - Opening the browser share sheet.
  - Adds the "This Page Session" panel and "Private to this tab. It is not saved or sent to DZN." message.
  - Opens the public profile page in a new tab so the current private session can show the feedback.

- `app/globals.css`
  - Adds scoped styling for the share session feedback panel and rows.

- `scripts/test-public-profile-share-session-feedback.ts`
  - Proves the feedback is local browser presentation only.
  - Proves the share panel does not use storage, beacons, analytics/tracking names, fetches, server methods, SQL writes, payment hooks, Nitrado hooks, or Discord bot hooks.
  - Proves protected influence systems do not depend on the share session feedback classes or text.

- `package.json`
  - Adds `test:public-profile-share-session-feedback` and wires it into `npm test` after `test:public-profile-owner-preview-share-polish`.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/player/profile` share session feedback | Not exposed | Own profile only | Own profile only | Own profile only | Existing session-authenticated private profile page; feedback is component state only |
| `PublicProfileSharePanel` "This Page Session" panel | Not exposed outside private player surfaces | Own generated public link/handle only | Own generated public link/handle only | Own generated public link/handle only | Browser-only state for current tab; no fetch/write/storage |
| `/players/[handle]` public viewer | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Existing read-only public profile API; not affected by share session feedback |
| `/api/player/profile-privacy` | 401 | Explicit Save Preferences only | Explicit Save Preferences only | Explicit Save Preferences only | Existing private player-owned settings API; share feedback cannot call it |
| Billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, competitive eligibility | No influence | No influence | No influence | No influence | No imports, calls, writes, or dependencies from share session feedback |

## Privacy Boundary

The session feedback may show only:

- Local action label.
- Local action detail.
- Browser-formatted time for the current tab session.

The session feedback must not expose:

- Discord IDs.
- Internal DZN user IDs.
- Source IDs or raw award evidence.
- Exact award timestamps.
- Billing rows or checkout state.
- Owner/admin import/export rows.
- Retained export artifacts.
- Nitrado tokens, Discord bot tokens, Stripe secrets, or Cloudflare secrets.

## Mutation Boundary

Allowed:

- `navigator.clipboard.writeText(...)` for the already-generated public profile URL or handle.
- `navigator.share(...)` for the already-generated public profile URL when the browser supports it.
- Local React `useState` updates for the mounted page.
- Opening the existing public profile href in a new tab.

Denied:

- `localStorage`, `sessionStorage`, IndexedDB, cookies, or browser beacons.
- Analytics, tracking events, telemetry calls, or audit-log calls.
- Fetches or API calls for share feedback.
- New `POST`, `PATCH`, `PUT`, or `DELETE` behavior.
- Profile privacy writes outside the existing explicit Save Preferences action.
- Migrations, retained export rows, stored share history, sharing links, storage bindings, or background jobs.

## Isolation Proof

Share session feedback remains presentation-only and cannot affect:

- Profile privacy settings.
- Billing or checkout.
- Scoring.
- Rankings or leaderboards.
- Discovery score.
- Reviews or review score.
- Badges.
- Seasons.
- Server Wars scoring.
- XP awards.
- Calling-card awards.
- Events.
- Competitive eligibility.

## Production Boundary

- Live checkout remains disabled.
- Issue #49 remains reserved for final live payment activation.
- No Stripe products/prices are mutated.
- No Cloudflare secrets are changed.
- No production D1 writes are made.
- No Nitrado calls are made.
- No Discord mutations are made.
- No retained export storage or sharing link model is added.

## Validation Targets

- `npm run test:public-profile-share-session-feedback`
- `npm run test:public-profile-owner-preview-share-polish`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-player-profile-visual-polish`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:player-profile-progression-showcase`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Production-mutation scans for migrations, checkout activation, Stripe/Nitrado/Discord/Cloudflare secret/D1 patterns
- Rendered desktop, mid-width, mobile, and reduced-motion smoke checks
- Codex Security diff scan

## Prior Next Recommended Slice

Next should be public profile share accessibility/fallback polish: improve keyboard and screen-reader affordances around copy/open/share states, make unavailable clipboard or browser-share fallbacks clearer, and keep proving those fallback controls do not store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.

## Follow-On Public Profile Share Accessibility/Fallback Polish

Branch: `codex/public-profile-share-a11y-fallback-polish-20260826`

Base branch: `codex/public-profile-share-session-feedback-20260826`

This slice improves keyboard and screen-reader clarity around the same private `/player/profile` public-profile share panel. It adds stable accessible labels and descriptions, focus-visible states, an `aria-live` share status region, browser capability checks, and fallback guidance for unavailable clipboard copy, unavailable browser share, or a missing generated public handle.

Still excluded:

- Stored share history, analytics events, tracking events, audit-log calls, beacons, cookies, `localStorage`, `sessionStorage`, IndexedDB, public-profile fetches, new privacy writes, retained export records, sharing links, storage bindings, and migrations.
- Public profile API changes, profile handle generation changes, profile privacy model changes, owner/admin import writes, retained export files, and retained export write APIs.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49.
- Billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, and competitive eligibility influence.

Live checkout remains disabled, retained exports remain blocked unless separately approved, and Issue #49 remains reserved for final live payment activation.

## Next Recommended Slice

Next should be public profile share preview metadata polish: add public-safe Open Graph/Twitter-style metadata and fallback preview copy for `/players/[handle]` using only already-public profile fields and saved visibility preferences, while proving metadata generation cannot expose hidden sections, store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.
