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

## Next Recommended Slice

Next should be public profile share analytics/audit-free UX polish: add lightweight client-only feedback that shows players when they last copied/opened/shared their public link during the current page session, without storing share history, creating tracking events, adding analytics calls, or changing profile privacy settings, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.
