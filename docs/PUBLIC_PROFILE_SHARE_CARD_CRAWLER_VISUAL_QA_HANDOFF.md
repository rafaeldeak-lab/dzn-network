# Public Profile Share-Card Crawler Visual QA Handoff

## Slice

Public Profile Share-Card Crawler Visual QA adds a local rendered preview check for `/players/[handle]` social-card metadata. It builds on the existing crawler head snapshot and image/card asset quality checks by rendering deterministic Open Graph and Twitter preview-card models from the final rewritten `<head>` values.

This slice is QA/documentation-only. It does not change runtime public profile behavior, player privacy settings, profile publishing, player progression awards, billing gates, rankings, discovery, reviews, events, Server Wars, CTF scoring, retained exports, owner/admin imports, Nitrado, Discord, Cloudflare secrets, production D1, live checkout, deployments, or issue #49.

## Architecture Found

- `/players/[handle]` is served by `functions/players/[handle].ts`.
- The route fetches `/players/preview.html` from `env.ASSETS`, gets the already public-safe profile payload, rewrites managed `<head>` tags, and returns no-store HTML.
- `functions/_lib/public-player-profile.ts` owns `buildPublicPlayerProfileSharePreviewMetadata`, `PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS`, and the public-safe share-card image contract.
- Prior crawler QA already snapshots published, hidden, invalid, and unavailable final head states.
- Prior image/card QA already validates `/media/dzn-cinematic-survivor.png` under `public/` and `out/` when exported build output exists.

## Implementation

- `scripts/test-public-profile-share-card-crawler-visual-qa.ts`
  - Renders `/players/[handle]` locally through the real Pages Function for published, hidden, invalid, and unavailable states.
  - Renders a fallback-image state by injecting metadata built with a missing future share-card candidate and proving it falls back to `/media/dzn-cinematic-survivor.png`.
  - Extracts the final `<head>` after the route rewrite.
  - Builds deterministic rendered social-card preview models for Open Graph and Twitter from the final head values.
  - Verifies the rendered preview cards use the correct image URL and alt text.
  - Verifies the preview image is the local static DZN PNG, at least `1200x630`, and still crawler-friendly.
  - Verifies titles, descriptions, canonical URLs, robots directives, preview source, image tags, and fallback copy are consistent across the rendered card model.
  - Verifies hidden synthetic profile fields do not appear in the rendered head or preview card HTML.
  - Verifies no share history, tracking, analytics, browser storage, server write, privacy write, checkout, Nitrado, Discord, or live-checkout behavior is introduced.
  - Verifies protected billing, scoring, ranking, discovery, review, badge, season, Server Wars, XP, calling-card, event, CTF, and community-member systems do not depend on this visual QA path.

- `package.json`
  - Adds `test:public-profile-share-card-crawler-visual-qa`.
  - Wires it into `npm test` immediately after `test:public-profile-share-preview-image-card-polish`.

- Documentation
  - Adds this handoff.
  - Updates `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`.
  - Updates `docs/PUBLIC_ACCESS_POLICY.md`.
  - Updates `docs/PUBLIC_PROFILE_SHARE_PREVIEW_IMAGE_CARD_POLISH_HANDOFF.md` with this completed follow-on slice.

## Visual QA Cases

- `published`
  - Real route render with a fake public-safe profile payload.
  - Expected `index,follow`, `og:type=profile`, public profile canonical URL, DZN default share-card image, and public-safe alt text.

- `hidden`
  - Real route render with no published profile row.
  - Expected generic `noindex,nofollow` fallback metadata and default DZN share-card image.

- `invalid`
  - Real route render with an invalid handle.
  - Expected generic `noindex,nofollow` fallback metadata and default DZN share-card image.

- `unavailable`
  - Real route render with no DB binding.
  - Expected generic `noindex,nofollow` fallback metadata and default DZN share-card image.

- `fallback_image`
  - Local final-head render using a missing future share-card candidate.
  - Expected public profile metadata with `fallback_asset` image resolution and default DZN share-card image/alt text in the rendered head.

## Mutation Boundary

Allowed:

- Read local source files.
- Read local `public/media/dzn-cinematic-survivor.png`.
- Render `/players/[handle]` through a fake read-only DB and fake ASSETS binding.
- Build deterministic social-card preview HTML in memory from final head tags.

Denied:

- Stored share history.
- Tracking events.
- Analytics calls.
- Audit-log calls.
- Browser storage, cookies, beacons, or persistent client state.
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

The rendered social-card preview proof is explicit: no hidden sections, no analytics/tracking calls, no stored share history, no privacy writes, and no billing, scoring, ranking, review, badge, season, Server Wars, XP/calling-card award, event, or competitive eligibility impact.

## Validation Targets

- `npm run test:public-profile-share-card-crawler-visual-qa`
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

## Follow-On Public Profile Social Preview Validation Package Slice

Branch: `codex/public-profile-social-preview-validation-package-20260826`

The next completed slice should add `scripts/test-public-profile-social-preview-validation-package.ts` and `test:public-profile-social-preview-validation-package`. It should produce deterministic local JSON and HTML artifacts under `docs/artifacts/public-profile-social-preview-validation-package/` containing sanitized rendered head/card snapshots for the published, hidden, invalid, unavailable, and fallback-image states. Reviewers should be able to inspect the exact crawler-visible preview contract without running production services. The package must keep proving no hidden sections, analytics/tracking calls, stored share history, privacy writes, billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP/calling-card awards, events, or competitive eligibility impact.

Live checkout remains disabled, and Issue #49 remains reserved for final live payment activation.
