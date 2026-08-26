# Public Profile Share Accessibility/Fallback Polish Handoff

Branch: `codex/public-profile-share-a11y-fallback-polish-20260826`

Base branch: `codex/public-profile-share-session-feedback-20260826`

Base commit: `956fcad90c8c71f20112dcbebf6554c9e6159432`

## Scope

This slice improves keyboard and screen-reader clarity around the private logged-in `/player/profile` public-profile share controls.

It also makes unavailable clipboard and browser-share behavior clearer without adding stored share history, tracking events, analytics calls, audit-log calls, privacy-setting writes, billing changes, scoring changes, ranking changes, review changes, badge/season/Server Wars changes, XP/calling-card award changes, event changes, or competitive eligibility impact.

## Implementation

- `components/player/public-profile-share-panel.tsx`
  - Adds `ShareCapabilityState` for local clipboard/native-share capability checks after mount.
  - Adds `clipboard_unavailable` and `share_unavailable` share states.
  - Adds stable IDs from `useId` for panel labelling, share status, and fallback guidance.
  - Adds explicit `aria-label` and `aria-describedby` coverage for open, copy-link, copy-handle, and browser-share controls.
  - Adds focus-visible keyboard rings to the share controls.
  - Adds an `aria-live` status region for copy/open/share success and unavailable/failure states.
  - Adds `ShareFallbackGuidance` for Clipboard copy is unavailable, Browser share is unavailable, and missing generated-handle states.
  - Keeps share session feedback in local component state only.

- `app/globals.css`
  - Adds scoped styling for the fallback guidance panel.

- `scripts/test-public-profile-share-a11y-fallback-polish.ts`
  - Proves the accessibility/fallback controls exist.
  - Proves the share panel does not use browser persistence, beacons, analytics/tracking names, fetches, server methods, SQL writes, payment hooks, Nitrado hooks, or Discord bot hooks.
  - Proves the public profile viewer, public profile read model, profile privacy API, billing, rankings, discovery, reviews, badges, seasons, Server Wars, progression, events, CTF, and community member source-management code do not depend on the fallback UI.

- `package.json`
  - Adds `test:public-profile-share-a11y-fallback-polish` and wires it into `npm test` immediately after `test:public-profile-share-session-feedback`.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/player/profile` share accessibility/fallback controls | Not exposed | Own profile only | Own profile only | Own profile only | Existing session-authenticated private profile page; fallback state is component state only |
| `PublicProfileSharePanel` `aria-live` status and fallback guidance | Not exposed outside private player surfaces | Own generated public link/handle only | Own generated public link/handle only | Own generated public link/handle only | Browser-only capability checks and local UI; no fetch/write/storage |
| `/players/[handle]` public viewer | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Existing read-only public profile API; not affected by fallback UI |
| `/api/player/profile-privacy` | 401 | Explicit Save Preferences only | Explicit Save Preferences only | Explicit Save Preferences only | Existing private player-owned settings API; fallback UI cannot call it |
| Billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, competitive eligibility | No influence | No influence | No influence | No influence | No imports, calls, writes, or dependencies from share accessibility/fallback polish |

## Accessibility Boundary

Allowed:

- Accessible labels and descriptions for the existing share controls.
- `aria-live` and `aria-atomic` status text for local share-control outcomes.
- Focus-visible keyboard states.
- Disabled UI states when clipboard or browser share support is unavailable.
- Fallback guidance that points users to the public page address bar or the Copy Link control.

Denied:

- New keyboard shortcuts that trigger network or persistence behavior.
- Hidden tracking fields.
- Share evidence or audit labels.
- Screen-reader-only content containing private identifiers, raw IDs, source evidence, billing rows, owner/admin rows, or exact award timestamps.

## Mutation Boundary

Allowed:

- `navigator.clipboard.writeText(...)` for the already-generated public profile URL or handle.
- `navigator.share(...)` for the already-generated public profile URL when the browser supports it.
- Local React `useState` updates for the mounted page.
- Local browser capability checks.
- Opening the existing public profile href in a new tab.

Denied:

- `localStorage`, `sessionStorage`, IndexedDB, cookies, or browser beacons.
- Analytics, tracking events, telemetry calls, or audit-log calls.
- Fetches or API calls for share feedback or fallback state.
- New `POST`, `PATCH`, `PUT`, or `DELETE` behavior.
- Profile privacy writes outside the existing explicit Save Preferences action.
- Migrations, retained export rows, stored share history, sharing links, storage bindings, or background jobs.

## Isolation Proof

Share accessibility/fallback polish remains presentation-only and cannot affect:

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

- `npm run test:public-profile-share-a11y-fallback-polish`
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

Next should be public profile share preview metadata polish: add public-safe Open Graph/Twitter-style metadata and fallback preview copy for `/players/[handle]` using only already-public profile fields and saved visibility preferences, while proving metadata generation cannot expose hidden sections, store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.

## Follow-On Public Profile Share Preview Metadata Polish

Branch: `codex/public-profile-share-preview-metadata-polish-20260826`

Base branch: `codex/public-profile-share-a11y-fallback-polish-20260826`

This slice adds public-safe Open Graph/Twitter-style metadata and fallback preview copy for `/players/[handle]`. The statically exported Next profile route keeps generic fallback metadata, while the Cloudflare Pages shell route rewrites `/players/[handle]` HTML with per-handle tags from the already-filtered public profile payload.

Still excluded:

- Hidden profile sections, private identifiers, raw award evidence, exact award timestamps, source IDs, private settings, owner/admin rows, retained export artifacts, billing rows, scoring rows, review internals, approval state, and event internals.
- Stored share history, analytics calls, tracking events, audit-log calls, browser persistence, profile privacy writes, handle creation, retained export writes, and migrations.
- Stripe checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49.
- Billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, CTF scoring, and competitive eligibility influence.

Live checkout remains disabled, retained exports remain blocked unless separately approved, and Issue #49 remains reserved for final live payment activation.

## Next Recommended Slice

Next should be public profile share preview crawler/rendered QA polish: add a local smoke harness that renders rewritten `/players/[handle]` metadata for published, hidden, invalid, and unavailable profiles and snapshots the final `<head>` tags while continuing to prove no hidden fields, tracking, analytics, stored share history, privacy writes, billing changes, scoring changes, ranking changes, review changes, badge/season/Server Wars changes, XP/calling-card award changes, event changes, or competitive eligibility impact.
