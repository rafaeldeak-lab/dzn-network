# Public Profile Owner Preview And Share Polish Handoff

Date: 2026-08-26

Branch: `codex/public-profile-owner-preview-share-polish-20260826`

Base branch: `origin/codex/player-public-profile-visual-polish-20260826`

Base commit: `b3b1567e6ba1f7f86efdbd264a5505746af63252`

## Scope

This slice improves the private `/player/profile` public-profile owner preview and share experience after the public `/players/[handle]` visual polish.

It gives players a clearer "How My Public Profile Looks" panel from their own logged-in account, stronger hidden-section and unsaved-change warnings, and improved copy/share controls for the already-generated public profile link.

## Implementation

- `components/player/public-profile-share-panel.tsx`
  - Adds `PublicProfileOwnerPreview` as a client-only preview data contract.
  - Adds `PublicProfileOwnerPreviewCard` inside the existing share panel.
  - Adds visible/hidden rows for XP, challenge progress, calling cards, and award dates.
  - Adds copy actions for the full public link and generated public handle.
  - Keeps native browser sharing as an optional browser capability.

- `components/player/player-profile-progression-page.tsx`
  - Builds the owner preview from the existing private profile payload and local visibility controls.
  - Labels unsaved local toggle changes as local preview only until Save Preferences is used.
  - Uses no public profile fetch, no new API route, and no new storage model.

- `app/globals.css`
  - Adds DZN-branded styling for the owner preview/share panel.

- `scripts/test-public-profile-owner-preview-share-polish.ts`
  - Proves the preview/share panel stays local browser UI only.
  - Proves the private profile page still has one profile read and one explicit privacy save path.
  - Proves protected systems do not depend on the owner preview/share classes or text.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/player/profile` owner preview/share UI | Login required | Own profile only | Own profile only | Own profile only | Session auth through existing player profile route; preview is client presentation only |
| `PublicProfileSharePanel` copy/share controls | Not exposed outside private player surfaces | Own generated public link/handle only | Own generated public link/handle only | Own generated public link/handle only | Local browser clipboard/share sheet only; no fetch/write |
| `/api/player/profile-privacy` | 401 | GET/PATCH own row only | GET/PATCH own row only | GET/PATCH own row only | Existing private player-owned settings API |
| `/players/[handle]` | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Existing public-safe read-only API projection |

## Privacy Boundary

The private owner preview may show only values already available to the logged-in player from their private profile payload and current local controls:

- display name;
- generated public handle when present;
- generated public href when present;
- public-safe XP total;
- joined/completed challenge counts;
- calling-card count;
- visible/hidden section state;
- month-level award-date messaging.

It must not expose Discord IDs, internal DZN user IDs, Discord avatar hashes or derived public avatar URLs, source IDs, source tables, raw award evidence, ADM source rows, billing rows, owner account state, Nitrado tokens, Discord bot tokens, Stripe state, Cloudflare secrets, retained export artifacts, or exact award timestamps.

## Mutation Boundary

Preview/share controls may only:

- open the existing public href;
- copy the existing public href;
- copy the existing generated handle;
- invoke `navigator.share` when the browser supports it.

The preview/share UI must not fetch public profile data, write profile privacy settings, create handles, create checkout sessions, mutate billing, mutate reviews, update rankings, alter discovery score, award XP, award calling cards, change challenge progress, change seasons, alter events, alter Server Wars scoring, touch retained exports, call Nitrado, mutate Discord resources, change Cloudflare secrets, write production D1, enable live checkout, or merge issue #49.

The only profile privacy write remains the existing explicit Save Preferences action against `/api/player/profile-privacy`.

## Isolation Proof

Owner preview/share UI and copy/share controls cannot affect profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.

Protected systems remain isolated:

- billing and checkout;
- server rankings and public leaderboards;
- server discovery score and visibility;
- reviews and review score;
- badges and badge evaluation;
- seasons;
- Server Wars scoring;
- XP award cron jobs;
- calling-card award logic;
- CTF/event scoring and roster decisions;
- retained exports and owner/admin community-member import controls.

## Production Boundary

Live checkout remains disabled. This slice does not change `DZN_LIVE_CHECKOUT_ENABLED`, Stripe products/prices, Stripe secrets, Cloudflare secrets, production D1, Nitrado, Discord, retained exports, migrations, or issue #49.

No deployment is part of this slice.

## Validation Targets

- `npm run test:public-profile-owner-preview-share-polish`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-player-profile-visual-polish`
- `npm run test:public-profile-discovery-linking-polish`
- `npm run test:public-profile-attribution-controls-polish`
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

Next should be public profile share analytics/audit-free UX polish: add lightweight client-only feedback that shows players when they last copied/opened/shared their public link during the current page session, without storing share history, creating tracking events, adding analytics calls, or changing profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.

## Follow-On Public Profile Share Session Feedback

Branch: `codex/public-profile-share-session-feedback-20260826`

Base branch: `codex/public-profile-owner-preview-share-polish-20260826`

This slice adds the analytics-free and audit-free session feedback requested for the private `/player/profile` share panel. It keeps the feedback inside `PublicProfileSharePanel` component state only, so the page can show what the player last opened, copied, or shared in the current tab without storing or sending that action history.

The slice adds:

- A "This Page Session" panel inside the existing public profile share panel.
- Last-action rows for opening the public page, copying the full public profile link, copying the generated public handle, and opening the browser share sheet.
- A clear "Private to this tab. It is not saved or sent to DZN." message.
- `test:public-profile-share-session-feedback` to prove the feedback remains local browser presentation and does not become a dependency of protected influence systems.

Still excluded:

- Stored share history, analytics events, tracking events, audit-log calls, beacons, cookies, `localStorage`, `sessionStorage`, IndexedDB, public-profile fetches, new privacy writes, retained export records, sharing links, storage bindings, and migrations.
- Public profile API changes, profile handle generation changes, profile privacy model changes, owner/admin import writes, retained export files, and retained export write APIs.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49.
- Billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, and competitive eligibility influence.

Live checkout remains disabled, retained exports remain blocked unless separately approved, and Issue #49 remains reserved for final live payment activation.

## Prior Next Recommended Slice

Next should be public profile share accessibility/fallback polish: improve keyboard and screen-reader affordances around copy/open/share states, make unavailable clipboard or browser-share fallbacks clearer, and keep proving those fallback controls do not store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.

## Follow-On Public Profile Share Accessibility/Fallback Polish

Branch: `codex/public-profile-share-a11y-fallback-polish-20260826`

Base branch: `codex/public-profile-share-session-feedback-20260826`

This slice adds accessible labels/descriptions, focus-visible states, an `aria-live` status region, local browser capability checks, and fallback guidance to the private `/player/profile` public-profile share panel. It clarifies unavailable clipboard copy, unavailable browser share, and missing generated-handle states without adding persistence, tracking, analytics, audit logs, or server writes.

Still excluded:

- Stored share history, analytics events, tracking events, audit-log calls, beacons, cookies, `localStorage`, `sessionStorage`, IndexedDB, public-profile fetches, new privacy writes, retained export records, sharing links, storage bindings, and migrations.
- Public profile API changes, profile handle generation changes, profile privacy model changes, owner/admin import writes, retained export files, and retained export write APIs.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49.
- Billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, and competitive eligibility influence.

Live checkout remains disabled, retained exports remain blocked unless separately approved, and Issue #49 remains reserved for final live payment activation.

## Next Recommended Slice

Next should be public profile share preview metadata polish: add public-safe Open Graph/Twitter-style metadata and fallback preview copy for `/players/[handle]` using only already-public profile fields and saved visibility preferences, while proving metadata generation cannot expose hidden sections, store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.
