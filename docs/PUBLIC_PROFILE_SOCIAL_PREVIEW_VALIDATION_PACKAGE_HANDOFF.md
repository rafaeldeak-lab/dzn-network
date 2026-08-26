# Public Profile Social Preview Validation Package Handoff

## Slice

Public Profile Social Preview Validation Package creates a durable local reviewer artifact for `/players/[handle]` crawler preview metadata. It builds on the share-card crawler visual QA slice by committing sanitized JSON and HTML snapshots that can be inspected without running production services.

This slice is QA/documentation-only. It does not change runtime public profile behavior, player privacy settings, profile publishing, player progression awards, billing gates, rankings, discovery, reviews, events, Server Wars, CTF scoring, retained exports, owner/admin imports, Nitrado, Discord, Cloudflare secrets, production D1, live checkout, deployments, or issue #49.

It also records the future DZN chat/support direction in the master spec and public access policy: site-wide support chat, global player chat, private group chat, profanity filtering, warnings, timed mutes/timeouts, moderation hooks, and an automated support bot limited to public DZN website/setup-help content only. That roadmap item is not implemented by this slice.

## Architecture Found

- `/players/[handle]` is served by `functions/players/[handle].ts`.
- The route fetches `/players/preview.html` from `env.ASSETS`, gets the already public-safe profile payload, rewrites managed `<head>` tags, and returns no-store HTML.
- `functions/_lib/public-player-profile.ts` owns `buildPublicPlayerProfileSharePreviewMetadata`, `PUBLIC_PLAYER_PROFILE_SHARE_PREVIEW_IMAGE_CARDS`, and the public-safe share-card image contract.
- `scripts/test-public-profile-share-card-crawler-visual-qa.ts` renders published, hidden, invalid, unavailable, and fallback-image states with fake ASSETS and a fake read-only DB.

## Implementation

- `scripts/test-public-profile-share-card-crawler-visual-qa.ts`
  - Exports `buildPublicProfileShareCardCrawlerVisualQaEvidence`.
  - Adds sanitized `head_html` to each rendered head snapshot.
  - Keeps direct test execution intact through an `import.meta.url` entrypoint guard.

- `scripts/test-public-profile-social-preview-validation-package.ts`
  - Reuses the local visual QA render path.
  - Builds a deterministic validation package for published, hidden, invalid, unavailable, and fallback-image states.
  - Writes a bounded JSON artifact and a static no-script HTML reviewer artifact.
  - Verifies the written files exactly match the regenerated package.
  - Verifies every packaged state includes the final crawler image URL and public-safe alt text.
  - Verifies packaged Open Graph and Twitter card fields mirror the final rewritten `<head>`.
  - Verifies hidden synthetic fields do not appear in packaged JSON or HTML.
  - Verifies the package contains no scripts, forms, browser storage, beacons, analytics calls, tracking calls, audit-share calls, API write methods, checkout creation paths, live-service token names, raw SQL write operations, or production mutation commands.
  - Verifies docs include the validation package contract and the future chat/support bot roadmap.

- `docs/artifacts/public-profile-social-preview-validation-package/public-profile-social-preview-validation-package.json`
  - Machine-readable sanitized reviewer package.

- `docs/artifacts/public-profile-social-preview-validation-package/index.html`
  - Human-readable static reviewer package.
  - Uses a local relative image preview for the existing DZN share-card asset.
  - Shows the exact crawler image URL in text/data attributes without loading production services.

- `package.json`
  - Adds `test:public-profile-social-preview-validation-package`.
  - Wires it into `npm test` immediately after `test:public-profile-share-card-crawler-visual-qa`.

- Documentation
  - Adds this handoff.
  - Updates `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`.
  - Updates `docs/PUBLIC_ACCESS_POLICY.md`.
  - Updates `docs/PUBLIC_PROFILE_SHARE_CARD_CRAWLER_VISUAL_QA_HANDOFF.md` with this completed follow-on slice.

## Packaged States

- `published`
  - Indexable public profile preview.
  - Uses only the already public-safe profile payload.

- `hidden`
  - Generic `noindex,nofollow` fallback metadata.
  - Does not expose profile-derived fields.

- `invalid`
  - Generic `noindex,nofollow` fallback metadata for invalid handles.
  - Does not expose request query noise or hidden fields.

- `unavailable`
  - Generic `noindex,nofollow` fallback metadata when the DB binding is unavailable.
  - Does not expose private or partial profile state.

- `fallback_image`
  - Indexable public profile preview because the profile payload is public.
  - Missing future share-card references fall back to `/media/dzn-cinematic-survivor.png`.

## Artifact Boundary

Allowed:

- Read local source files.
- Read local `public/media/dzn-cinematic-survivor.png` through the reused visual QA harness.
- Render `/players/[handle]` through fake ASSETS and a fake read-only DB.
- Build sanitized JSON and static HTML reviewer artifacts under `docs/artifacts/public-profile-social-preview-validation-package/`.
- Include final crawler-visible metadata, final sanitized `<head>` HTML, rendered Open Graph/Twitter card HTML strings, local image preview references, reviewer notes, and explicit false safety flags.

Denied:

- Runtime route changes.
- Stored share history.
- Tracking events.
- Analytics calls.
- Audit-share calls.
- Scripts or forms in the reviewer artifact.
- Browser storage, cookies, beacons, or persistent client state.
- API write methods.
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

The packaged reviewer proof is explicit: no hidden sections, no analytics/tracking calls, no stored share history, no privacy writes, and no billing, scoring, ranking, review, badge, season, Server Wars, XP/calling-card award, event, or competitive eligibility impact.

## Chat / Support Bot Roadmap Boundary

The future chat/support plan is intentionally not implemented here.

Future implementation must be split into a dedicated architecture preflight before any chat database, WebSocket, Durable Object, provider, moderation queue, or bot route is added. That preflight should define:

- Public support entry points on most pages.
- Logged-in global community chat.
- Private group chat scoped by trusted community, team, event, or server membership bridges.
- Profanity filtering, warning, timed-mute/timeout, report, and moderation workflows.
- AI support answers limited to public DZN website, setup-help, pricing, and support-policy content.
- No access to private player data, private owner data, Discord IDs, Nitrado tokens, billing secrets, production D1 internals, retained exports, raw award evidence, or hidden profile sections.
- No AI provider credential, paid API key, metered model call, vector store, training/eval job, or automated spend path until explicitly approved with cost controls and rollback.

## Validation Targets

- `npm run test:public-profile-social-preview-validation-package`
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
- No chat runtime, bot runtime, AI provider credential, or paid model call is added.

## Follow-On DZN Chat Support Architecture Preflight

The next slice is DZN chat/support architecture preflight.

It is captured in `docs/DZN_CHAT_SUPPORT_ARCHITECTURE_PREFLIGHT.md` and verified by `npm run test:dzn-chat-support-architecture-preflight`.

It designs the site-wide support chat, logged-in global player chat, private group chat, moderation/profanity warning and timed mute/timeout model, and public-DZN-info-only AI support bot boundaries before runtime work begins.

It keeps live checkout disabled, issue #49 reserved, zero-surprise AI spend, private player/owner data isolation, and no billing, scoring, rankings, reviews, badges, seasons, Server Wars, XP/calling-card awards, events, or competitive eligibility impact.

## Next Recommended Slice

Next should be a DZN Comms visual shell and support launcher prototype: build the logged-in community/support UI shell from static local mock data, with the DZN Comms layout, channel rail, safety rail, DZN Assist panel, and disabled/non-sending composer states. That slice should still avoid message storage, runtime chat APIs, Durable Objects/WebSockets, moderation tables, bot prompts, vector stores, AI provider credentials, metered model calls, live checkout, production services, and issue #49.
