# Public Profile Share Preview Crawler QA Handoff

## Slice

Public profile share preview crawler/rendered QA polish adds a local smoke harness for the rewritten `/players/[handle]` shell. The harness renders crawler-style HTML responses for published, hidden, invalid, and unavailable profiles, snapshots the final `<head>` metadata, and proves crawlers see the expected public-safe preview tags.

This slice is QA-only. It does not change public profile runtime behavior, profile publishing, privacy preference persistence, public handle generation, player progression awards, billing gates, rankings, discovery, reviews, events, Server Wars, CTF scoring, retained exports, owner/admin imports, Nitrado, Discord, Cloudflare secrets, production D1, live checkout, or issue #49.

## Architecture Found

- The Next app uses static export, so `app/players/[handle]/page.tsx` can only provide generic fallback metadata for the exported `/players/preview` shell.
- Arbitrary `/players/[handle]` URLs are served by the Cloudflare Pages function at `functions/players/[handle].ts`.
- That Pages function fetches `/players/preview.html` from `env.ASSETS`, reads the public-safe profile payload, injects Open Graph/Twitter/fallback tags into the response `<head>`, strips old managed tags, and returns `no-store` HTML.
- The authoritative public-safe profile source remains `getPublicPlayerProfilePayload` in `functions/_lib/public-player-profile.ts`.
- Hidden, invalid, unpublished, unavailable, or failed lookups receive generic `noindex,nofollow` metadata.

## Implementation

- `scripts/test-public-profile-share-preview-crawler-qa.ts`
  - Calls the actual `functions/players/[handle].ts` `onRequestGet` handler.
  - Supplies a fake exported `/players/preview.html` asset shell with stale static metadata.
  - Supplies a read-only fake D1 binding for the published and hidden cases.
  - Rejects any write SQL through the fake D1 binding.
  - Renders four crawler cases:
    - Published profile.
    - Hidden/unpublished profile.
    - Invalid handle.
    - Unavailable profile data.
  - Extracts the final response `<head>` without executing client JavaScript.
  - Snapshots title, description, canonical, robots, Open Graph, Twitter, DZN fallback preview-copy, preview source, cache/content headers, asset path, duplicate managed-tag state, body-shell preservation, and write-query count.
  - Proves old static shell metadata is replaced by the generated public-safe metadata.
  - Proves hidden fields do not appear in any crawler-visible snapshot.
  - Proves no analytics/tracking calls, stored share history, browser persistence, privacy writes, checkout behavior, Nitrado calls, Discord bot calls, live checkout activation, or protected-system dependencies are introduced.

- `package.json`
  - Adds `test:public-profile-share-preview-crawler-qa`.
  - Wires it into `npm test` immediately after `test:public-profile-share-preview-metadata-polish`.

## Crawler Snapshot Coverage

| Case | Input | Expected Metadata | Enforcement |
| --- | --- | --- | --- |
| Published profile | `/players/published-survivor` with a fake public profile row | Profile title, visible XP/challenge/calling-card summary, canonical URL, Open Graph `profile`, Twitter large card, DZN fallback preview copy, `index,follow` | Uses only the already-filtered public payload and saved visibility preferences |
| Hidden profile | `/players/hidden-survivor` with no enabled public row | Generic DZN player profile title/description, canonical URL, Open Graph `website`, Twitter large card, `noindex,nofollow` | No private user row is exposed |
| Invalid handle | `/players/bad!!handle` | Generic DZN player profile title/description, canonical URL with query removed, Open Graph `website`, Twitter large card, `noindex,nofollow` | Handle normalization fails before profile reads |
| Unavailable profile data | `/players/published-survivor` with no D1 binding | Generic DZN player profile title/description, canonical URL, Open Graph `website`, Twitter large card, `noindex,nofollow` | Public payload unavailable state cannot leak internals |

## Metadata Boundary

Allowed in crawler-visible metadata:

- Public display name from the public profile payload.
- Canonical public profile URL.
- Public preview image URL.
- Visible XP level/XP summary only when `visibility.xp` is true.
- Visible challenge completion summary only when `visibility.challenge_progress` is true.
- Visible calling-card count only when `visibility.calling_cards` is true.
- Generic fallback preview copy for hidden, missing, invalid, or unavailable profiles.

Denied in crawler-visible metadata:

- Hidden XP.
- Hidden challenge progress.
- Hidden calling cards.
- Private identifiers.
- Discord IDs.
- Internal DZN user IDs.
- Source IDs.
- Raw award evidence.
- Exact award timestamps.
- Private profile settings.
- Owner/admin rows.
- Retained export artifacts.
- Billing state.
- Scoring rows.
- Review internals.
- Approval state.
- Event internals.
- CTF or Server Wars scoring data.

## Mutation Boundary

Allowed:

- Read the static exported profile shell from fake `env.ASSETS` in the local harness.
- Read fake public profile rows through a read-only fake D1 binding.
- Render the final response HTML in memory.
- Extract and compare final `<head>` metadata snapshots.

Denied:

- Stored share history.
- Tracking events.
- Analytics calls.
- Audit-log calls.
- Cookies, localStorage, sessionStorage, IndexedDB, beacons, or browser persistence.
- Profile privacy writes.
- Profile handle creation.
- Checkout session creation.
- Billing updates.
- Ranking, leaderboard, or discovery-score writes.
- Review mutations.
- Badge, season, Server Wars, XP, calling-card, event, CTF, or competitive eligibility changes.
- Retained export files, export-history rows, sharing links, storage bindings, or retention write APIs.
- Nitrado calls.
- Discord mutations.
- Cloudflare secret changes.
- Production D1 writes or migrations.
- Live checkout activation.
- Issue #49 merge or mutation.

## Isolation Proof

The crawler QA harness proves the rewritten `/players/[handle]` shell can be rendered and snapshot-tested with no hidden fields in crawler-visible metadata, no stored share history, and without analytics/tracking calls, share-history storage, privacy writes, billing changes, scoring changes, ranking changes, review changes, badge/season/Server Wars changes, XP/calling-card award changes, event changes, or competitive eligibility impact.

## Production Boundary

- Live checkout remains disabled.
- Issue #49 remains reserved for final live payment activation.
- No Stripe products/prices are mutated.
- No Cloudflare secrets are changed.
- No production D1 writes are made.
- No migrations are added or applied.
- No Nitrado calls are made.
- No Discord mutations are made.
- No deployment is performed.
- No retained export storage or sharing link model is added.

## Validation Targets

- `npm run test:public-profile-share-preview-crawler-qa`
- `npm run test:public-profile-share-preview-metadata-polish`
- `npm run test:public-profile-share-a11y-fallback-polish`
- `npm run test:public-profile-share-session-feedback`
- `npm run test:public-profile-owner-preview-share-polish`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-player-profile-visual-polish`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `npm test`
- `git diff --check`
- Production-mutation scans for migrations, checkout activation, Stripe/Nitrado/Discord/Cloudflare secret/D1 patterns.
- Codex Security diff scan.

## Prior Next Recommended Slice

Next should be public profile share preview image/card polish: add a public-safe social preview image quality check for `/media/dzn-cinematic-survivor.png` and any future DZN share-card asset references, proving the image exists in the exported/static assets, has suitable crawler-friendly dimensions and alt text, falls back cleanly when unavailable, and still cannot expose hidden profile sections, store share history, create tracking events, call analytics, write privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.

## Follow-On Public Profile Share Preview Image/Card Polish

Branch: `codex/public-profile-share-preview-image-card-polish-20260826`

Base: `origin/codex/public-profile-share-preview-crawler-qa-20260826`

This slice adds a canonical public-safe share-card asset catalog for `/players/[handle]` metadata and a focused local QA script. The QA script validates `/media/dzn-cinematic-survivor.png`, checks actual static image bytes for crawler-friendly dimensions and alt text, automatically checks `out/` after a local static export exists, and proves future missing or unsafe share-card candidates fall back to the default DZN cinematic survivor card.

Validation added:

- `npm run test:public-profile-share-preview-image-card-polish`

The slice remains metadata/QA-only. It does not store share history, create tracking events, call analytics, write privacy settings, alter billing, scoring, rankings, discovery, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, competitive eligibility, Nitrado, Discord, Stripe, Cloudflare secrets, production D1, live checkout, deployments, or issue #49.

## Next Recommended Slice

Next should be public profile share preview rendered media QA polish: run the built `/players/[handle]` shell through a local static preview for published, hidden, invalid, and unavailable profile states, verify the social preview image actually loads from static assets with no media/console errors, capture desktop/mobile/reduced-motion rendered evidence, and keep proving the route cannot expose hidden profile sections, store share history, create tracking events, call analytics, write privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.
