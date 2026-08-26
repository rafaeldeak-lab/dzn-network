# Public Profile Share Preview Metadata Polish Handoff

## Slice

Public profile share preview metadata polish adds public-safe Open Graph/Twitter-style metadata and fallback preview copy for `/players/[handle]`.

This slice is presentation-only. It does not change profile publication rules, privacy preference persistence, public profile handle generation, player progression awards, billing gates, rankings, reviews, events, Server Wars, CTF scoring, retained exports, owner/admin imports, Nitrado, Discord, Cloudflare secrets, production D1, live checkout, or issue #49.

## Architecture Found

- The Next app uses `output: "export"`.
- `app/players/[handle]/page.tsx` statically exports only the `/players/preview` shell through `generateStaticParams`.
- Arbitrary public profile handle URLs are served by the Cloudflare Pages function at `functions/players/[handle].ts`, which fetches `/players/preview.html` from `env.ASSETS`.
- The authoritative public-safe data model is `getPublicPlayerProfilePayload` in `functions/_lib/public-player-profile.ts`.
- `GET /api/public/player-profiles/[handle]` already enforces published handles, saved visibility preferences, hidden private identifiers, hidden raw award evidence, and hidden exact award timestamps.

Because of that static-export architecture, real per-handle metadata belongs in the Pages shell function. The Next route keeps generic static fallback metadata for the exported preview shell, and `functions/players/[handle].ts` rewrites that shell with per-handle tags at request time.

## Implementation

- `functions/_lib/public-player-profile.ts`
  - Adds `PublicPlayerProfileSharePreviewMetadata`.
  - Adds `buildPublicPlayerProfileSharePreviewMetadata`.
  - Builds title, description, canonical URL, Open Graph, Twitter card, image, fallback preview copy, privacy safeguards, and fairness metadata.
  - Uses only the already-filtered `PublicPlayerProfileResponse`.
  - Reads XP, challenge progress, and calling cards only when the matching saved visibility flag is true.
  - Emits generic `noindex,nofollow` fallback metadata for invalid, hidden, unpublished, unavailable, or failed profile lookups.

- `functions/players/[handle].ts`
  - Fetches the static `/players/preview.html` shell from `env.ASSETS`.
  - Safely reads the public profile payload for the requested handle.
  - Rewrites the shell with per-handle `<title>`, `description`, canonical, Open Graph, Twitter, image, and DZN fallback preview-copy tags.
  - Strips the old static managed tags before injection to avoid duplicate title/description/OG/Twitter tags.
  - Keeps the response `no-store`.
  - Does not add cookies, browser storage, analytics, tracking, share-history writes, audit writes, or API mutations.

- `app/players/[handle]/page.tsx`
  - Adds generic static fallback metadata for the exported preview shell.
  - Keeps `dynamicParams = false` and `generateStaticParams`.
  - Keeps the visible UI delegated to `PublicPlayerProfilePage`.

- `scripts/test-public-profile-share-preview-metadata-polish.ts`
  - Proves the metadata projection is visibility-aware.
  - Proves hidden sections are omitted even if contradictory synthetic section data exists.
  - Proves invalid/hidden profile fallbacks use generic noindex metadata.
  - Proves HTML injection replaces old managed tags and includes Open Graph/Twitter/fallback tags.
  - Proves share-preview metadata does not become a dependency of billing, rankings, discovery, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, CTF, or owner/community import code.

- `package.json`
  - Adds `test:public-profile-share-preview-metadata-polish`.
  - Wires it into `npm test` immediately after `test:public-profile-share-a11y-fallback-polish`.

## Access Matrix

| Surface | Visitor | Free Discord player | Starter trial/active | Pro active or legacy effective Pro | Enforcement |
| --- | --- | --- | --- | --- | --- |
| `/players/[handle]` static fallback metadata | Generic preview shell only | Generic preview shell only | Generic preview shell only | Generic preview shell only | Next static export fallback; no private data and no entitlement lookup |
| `/players/[handle]` Pages shell metadata | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Reads `getPublicPlayerProfilePayload`; hidden/unavailable profiles receive generic `noindex,nofollow` metadata |
| `GET /api/public/player-profiles/[handle]` | Published profiles only | Published profiles only | Published profiles only | Published profiles only | Existing public-safe read model; saved visibility preferences decide visible sections |
| `/player/profile` share controls | Not exposed | Own profile only | Own profile only | Own profile only | Existing private player page; this slice does not change copy/open/share controls |
| `/api/player/profile-privacy` | 401 | Explicit Save Preferences only | Explicit Save Preferences only | Explicit Save Preferences only | Existing private settings API; metadata generation cannot call or write it |
| Billing, rankings, discovery, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, CTF scoring, competitive eligibility | No influence | No influence | No influence | No influence | No imports, calls, writes, or dependencies from share-preview metadata |

## Public Metadata Boundary

Allowed in metadata:

- Display name from the public profile payload.
- Canonical public profile URL.
- Public preview image URL.
- Visible profile level and XP summary only when `visibility.xp` is true.
- Visible challenge completion summary only when `visibility.challenge_progress` is true.
- Visible calling-card count only when `visibility.calling_cards` is true.
- Generic fallback preview copy for hidden, missing, invalid, or unavailable profiles.

Denied in metadata:

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

- Read the static exported profile shell from `env.ASSETS`.
- Read the already-public profile payload.
- Rewrite response HTML head metadata in memory for the current response.
- Return generic fallback metadata when public profile data is unavailable.

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

Public profile share preview metadata cannot expose hidden sections, store share history, create tracking events, call analytics, write profile privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or affect competitive eligibility.

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

- `npm run test:public-profile-share-preview-metadata-polish`
- `npm run test:public-profile-share-a11y-fallback-polish`
- `npm run test:public-profile-share-session-feedback`
- `npm run test:public-profile-owner-preview-share-polish`
- `npm run test:public-player-profile-viewer`
- `npm run test:public-player-profile-visual-polish`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:player-profile-progression-showcase`
- `npm run test:public-community-member-card-preview-polish`
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

## Next Recommended Slice

Next should be public profile share preview crawler/rendered QA polish: add a small local smoke harness that renders the rewritten `/players/[handle]` shell for published, hidden, invalid, and unavailable profiles, snapshots the final `<head>` metadata, and proves crawlers see the expected public-safe preview tags without hidden fields, analytics/tracking calls, share-history storage, privacy writes, billing changes, scoring changes, ranking changes, review changes, badge/season/Server Wars changes, XP/calling-card award changes, event changes, or competitive eligibility impact.
