# Public Profile Share Preview Image/Card Polish Handoff

## Slice

Public profile share preview image/card polish adds a public-safe social preview image quality check for `/players/[handle]`. It keeps the existing public profile share-preview metadata behavior, but makes the image/card contract durable for `/media/dzn-cinematic-survivor.png` and any future DZN share-card asset references.

This slice is metadata/QA-only. It does not change public profile publishing, saved visibility preferences, player progression awards, billing gates, rankings, discovery, reviews, events, Server Wars, CTF scoring, retained exports, owner/admin imports, Nitrado, Discord, Cloudflare secrets, production D1, live checkout, deployments, or issue #49.

## Architecture Found

- `/players/[handle]` is served by the Cloudflare Pages function at `functions/players/[handle].ts`.
- The Pages function reads `/players/preview.html` from `env.ASSETS`, reads the public-safe profile payload, rewrites managed `<head>` tags, and returns private `no-store` HTML.
- `functions/_lib/public-player-profile.ts` owns the public-safe profile read model and the `PublicPlayerProfileSharePreviewMetadata` projection.
- Prior metadata polish already generated Open Graph/Twitter/fallback copy from the already-filtered public profile payload only.
- Prior crawler QA already snapshots published, hidden, invalid, and unavailable shell metadata states.
- The existing DZN share-card image is `public/media/dzn-cinematic-survivor.png`, a PNG with dimensions `1983x793`.

## Implementation

- `functions/_lib/public-player-profile.ts`
  - Adds `PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS` as the canonical catalog for public player profile share-card image references.
  - Registers `/media/dzn-cinematic-survivor.png` with public-safe alt text, `summary_large_image`, `1200x630` minimum dimensions, and a static public asset privacy contract.
  - Adds `PublicPlayerProfileSharePreviewImageCard` and `PublicPlayerProfileSharePreviewResolvedImageCard`.
  - Adds `resolvePublicPlayerProfileSharePreviewImageCard`.
  - Adds `image_card` to `PublicPlayerProfileSharePreviewMetadata`.
  - Keeps `image_href`, `image_alt`, Open Graph image tags, and Twitter image tags tied to the resolved card.
  - Falls back to the default DZN cinematic survivor card when a future configured candidate is missing from the available static asset set or is unsafe/misconfigured.

- `scripts/test-public-profile-share-preview-image-card-polish.ts`
  - Checks the canonical share-card catalog exists and includes `/media/dzn-cinematic-survivor.png`.
  - Ensures every public `/media/*` image reference in the helper is registered in the catalog.
  - Reads image bytes directly and parses PNG, JPEG, and WebP dimensions without calling external services.
  - Proves `/media/dzn-cinematic-survivor.png` exists under `public/media`, is a non-placeholder PNG, is `1983x793`, and meets the declared `1200x630` minimum.
  - Checks `out/` only when a local static export exists, proving exported static assets contain matching share-card images after build.
  - Verifies alt text is descriptive, public-safe, root-relative, and free of tracking/private-data language.
  - Verifies metadata uses the same resolved card for `image_href`, `image_alt`, Open Graph, and Twitter tags.
  - Verifies missing and unsafe future card candidates resolve with `fallback_asset` to the default DZN cinematic survivor card.
  - Verifies hidden synthetic profile values do not appear in crawler-visible image/card metadata.
  - Verifies the share-card catalog is not imported into billing, ranking, discovery, review, badge, season, Server Wars, XP, calling-card, event, Nitrado, Discord, or checkout paths.

- `package.json`
  - Adds `test:public-profile-share-preview-image-card-polish`.
  - Wires it into `npm test` immediately after `test:public-profile-share-preview-crawler-qa`.

- Documentation
  - Adds this handoff.
  - Updates `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`.
  - Updates `docs/PUBLIC_ACCESS_POLICY.md`.
  - Updates `docs/PUBLIC_PROFILE_SHARE_PREVIEW_CRAWLER_QA_HANDOFF.md` with the follow-on branch and new next slice.

## Image/Card Contract

Allowed:

- Root-relative public `/media/*` PNG, JPEG, or WebP share-card assets.
- Public-safe static artwork that does not embed private profile data.
- Descriptive alt text suitable for Open Graph and Twitter image alt metadata.
- `summary_large_image` Twitter card metadata.
- Minimum crawler-friendly dimensions of at least `1200x630` for the current default profile share-card.
- Optional exported asset verification under `out/` after a local static export exists.

Denied:

- Remote image URLs.
- Tracking URLs.
- Query strings or fragments.
- Path traversal.
- Missing files.
- Empty placeholders.
- Empty or private-data-bearing alt text.
- Hidden XP, hidden challenge progress, hidden calling cards, private identifiers, Discord IDs, internal DZN user IDs, source IDs, raw award evidence, exact award timestamps, private settings, owner/admin rows, retained export artifacts, billing state, scoring rows, review internals, approval state, event internals, CTF scoring, or Server Wars scoring.

## Mutation Boundary

Allowed:

- Read local static image files under `public/`.
- Read `out/` image files only when `out/` exists after a local static export.
- Build public profile share-preview metadata in memory with synthetic public-safe payloads.
- Parse local PNG, JPEG, and WebP image dimensions.

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
- Ranking, leaderboard, discovery-score, review, badge, season, Server Wars, XP, calling-card, event, CTF, or competitive eligibility changes.
- Retained export files, export-history rows, sharing links, storage bindings, or retention write APIs.
- Nitrado calls.
- Discord mutations.
- Cloudflare secret changes.
- Production D1 writes or migrations.
- Live checkout activation.
- Issue #49 merge or mutation.

## Validation Targets

- `npm run test:public-profile-share-preview-image-card-polish`
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
- `npm run test:public-profile-share-preview-image-card-polish` after build, to check `out/` when present.
- `npm test`
- `git diff --check`
- Production-mutation scans for migrations, checkout activation, Stripe/Nitrado/Discord/Cloudflare secret/D1 patterns.
- Codex Security diff scan.

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

## Next Recommended Slice

Next should be public profile share preview rendered media QA polish: run the built `/players/[handle]` shell through a local static preview for published, hidden, invalid, and unavailable profile states, verify the social preview image actually loads from static assets with no media/console errors, capture desktop/mobile/reduced-motion rendered evidence, and keep proving the route cannot expose hidden profile sections, store share history, create tracking events, call analytics, write privacy settings, alter billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP awards, calling-card awards, events, or competitive eligibility.
