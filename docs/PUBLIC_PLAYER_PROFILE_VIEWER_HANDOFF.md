# Public Player Profile Viewer Handoff

## Scope

This slice publishes a public-safe player profile reader for opted-in players. It builds on the persistent player profile privacy preferences slice by generating a public handle when a logged-in player enables public profile visibility, then exposing a read-only public route/API that respects the saved per-section preferences.

This is not an owner monetisation slice, not a public write slice, not a custom handle editor, and not a competitive progression-award slice.

## Follow-On Public Profile Discovery And Linking Polish

The follow-on public profile discovery/linking polish slice makes the published profile easier for players to find and share while keeping the public route read-only.

Branch details:

- Branch: `codex/public-profile-discovery-linking-polish-20260825`
- Base branch: `codex/public-profile-viewer-20260825`
- Base commit: `70d2d2294de40ea911c4466f25bf266cf5398cdc`

This follow-on slice adds:

- A private `public_profile` summary on `GET /api/player/hub`, sourced from the authenticated player's saved profile privacy preferences.
- Player-facing profile entry points from `/player`, `/player/profile`, `/events/challenges`, and DZN Pulse.
- Copy/share controls for the profile owner on private player surfaces when a generated public profile link exists.
- Clear settings entry states when the player has not published a public profile yet.
- Public-safe hidden/pending empty states on `/players/[handle]` for XP, challenge progress, calling cards, and timeline sections.

The follow-on slice does not add migrations, public write APIs, custom handle editing, checkout activation, owner entitlement changes, production D1 writes, Nitrado calls, Discord mutations, Stripe mutations, Cloudflare secret changes, or issue #49 changes.

## Branch And Base

- Branch: `codex/public-profile-viewer-20260825`
- Base branch: `codex/player-profile-privacy-preferences-20260825`
- Base commit: `11aeb235b5f042232f347af648bd1c87df74a70a`

## Added Surfaces

- `migrations/0066_player_public_profile_handles.sql`
  - Adds nullable `public_handle` to `player_profile_privacy_preferences`.
  - Adds a unique partial index for non-null public handles.
  - Does not touch billing, owner, ranking, review, event, badge, Server Wars, ADM, XP-award, calling-card-award, Nitrado, Discord, Stripe, or production data.

- `GET /api/public/player-profiles/[handle]`
  - Public read-only API for opted-in player profiles.
  - Resolves only generated public handles on rows where `public_profile_enabled = 1`.
  - Returns `404` for missing, unpublished, or disabled profiles.
  - Returns public cache headers for published profiles and no-store headers for errors or private-cookie requests.

- `/players/[handle]`
  - Public profile viewer page.
  - Shows only the profile sections selected by the player.
  - Uses the existing DZN visual language and does not add browser-side mutations.
  - Uses a static-export preview shell, while the browser derives the actual public handle from the `/players/...` path before reading the public API.

- `GET /players/[handle]`
  - Cloudflare Pages shell function for arbitrary public profile handles.
  - Serves the exported `/players/preview.html` client shell through `env.ASSETS`.
  - Does not authenticate, write data, call billing, call Stripe, call Nitrado, or call Discord.

- `/api/player/profile-privacy`
  - Continues to require a private logged-in player session.
  - Generates a public handle only when the authenticated player enables public profile visibility and no handle exists.
  - Ignores request-body `public_handle`, `user_id`, and `discord_id` values as authority sources.

- `/player/profile`
  - Shows the generated public profile link only when public profile visibility is enabled and a handle exists.

## Public Response Contract

The public profile response may include:

- Public handle.
- Public display name.
- Non-identifying avatar initial.
- Public route/API hrefs.
- Opted-in XP summary.
- Opted-in joined/completed challenge progress.
- Opted-in calling cards.
- Optional month/year award labels.
- Fairness metadata.

The public profile response must not expose:

- Discord IDs.
- Internal user IDs.
- Discord avatar hashes or derived avatar URLs.
- Source IDs or source table names.
- Raw award evidence.
- ADM source rows.
- Billing rows or owner account state.
- Nitrado tokens.
- Discord bot tokens.
- Stripe state or checkout configuration.
- Exact award timestamps.

## Visibility Rules

- `public_profile_enabled = false` means the public route returns `404`.
- `show_xp = false` removes public XP totals, profile level, XP-to-next-level, and XP text from public timeline details.
- `show_challenge_progress = false` removes public challenge progress and challenge timeline rows.
- `show_calling_cards = false` removes public calling cards and calling-card timeline rows.
- `show_award_dates = true` may expose only month/year labels such as `Aug 2026`; exact stored timestamps remain hidden.

## Fairness And Isolation

Public profile publishing and display choices are presentation-only. They must not affect:

- Billing.
- Rankings.
- Discovery.
- Reviews or review score.
- Badges.
- Seasons.
- Events.
- Server Wars scoring.
- XP awards.
- Calling-card awards.
- Competitive eligibility.

The public profile helper/API must not become a dependency of ranking, discovery, reviews, badges, seasons, events, Server Wars, billing, owner entitlement, XP-award, calling-card-award, Nitrado, Discord, or Stripe systems.

## Production Safety

This slice does not:

- Enable live checkout.
- Change `DZN_LIVE_CHECKOUT_ENABLED`.
- Create checkout sessions.
- Create or mutate Stripe products, prices, sessions, or webhooks.
- Change Cloudflare secrets.
- Mutate production D1.
- Call Nitrado.
- Send Discord bot messages or mutate Discord resources.
- Apply production migrations.
- Merge issue #49.

Issue #49 remains reserved for final live checkout activation.

## Validation Evidence

Completed on branch `codex/public-profile-viewer-20260825`:

- `npm run test:public-player-profile-viewer` passed.
- `npm run test:player-profile-privacy-preferences` passed.
- `npm run test:player-profile-progression-showcase` passed.
- `npm run test:challenges-xp-calling-cards-foundation` passed.
- `npm run test:progression-awards-foundation` passed.
- `npm run test:progression-award-source-adapters-audit` passed.
- `npm run test:progression-award-audit-ui` passed.
- `npm run test:billing-plans` passed using mocked/local checkout/webhook tests only.
- `npm run test:stripe-live-readiness` passed.
- `npm run test:stripe-live-activation-checklist` passed.
- `npm run test:public-leaderboards` passed.
- `npm run test:events` passed.
- `npm run test:server-war-scoring` passed.
- `npm run test:server-war-gating` passed.
- `npm run test:badge-awards` passed.
- `npm run test:badge-evaluation` passed.
- `npm run check:billing-config` passed and reported live checkout disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with four existing warnings outside this slice.
- `npm run build` passed and exported `/players/preview`; `scripts/patch-pages-routes.mjs` added `/players` and `/players/*` to the Cloudflare Pages function routes.
- `npm test` passed on the final tree. The optional latest ADM raw fixture check skipped because the owner-supplied raw bundle is not present locally.
- `git diff --check` passed.

Codex Security diff scan `8302d1da-18b0-42b5-991d-cbbbf9329995` completed with zero findings. TAC status could not be verified because the Codex Security Access connector is not connected.

Rendered local browser verification was attempted against `/players/rafaeldeak-a1b2c`, but the browser URL policy blocked localhost navigation. No screenshot evidence was captured. API/viewer behavior is covered by the focused route/helper tests and the production build.

Completed on branch `codex/public-profile-discovery-linking-polish-20260825`:

- `npm run test:public-profile-discovery-linking-polish` passed.
- `npm run test:player-hub-foundation` passed.
- `npm run test:player-profile-privacy-preferences` passed.
- `npm run test:public-player-profile-viewer` passed.
- `npm run test:challenges-xp-calling-cards-foundation` passed.
- `npm run test:dzn-pulse` passed.
- `npm run test:billing-plans` passed using mocked/local checkout/webhook tests only.
- `npm run test:stripe-live-readiness` passed.
- `npm run test:stripe-live-activation-checklist` passed.
- `npm run check:billing-config` passed and reported live checkout disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with four existing warnings outside this slice.
- `npm test` passed on the final tree. The optional latest ADM raw fixture check skipped because the owner-supplied raw bundle is not present locally.
- `git diff --check` passed.
- `npm run build` passed and exported `/player`, `/player/profile`, `/players/preview`, `/events/challenges`, and `/dzn-pulse`.
- Local route smoke returned `200` for `/player`, `/player/profile`, `/players/preview`, `/events/challenges`, and `/dzn-pulse`.
- Codex Security diff scan `baf6b4df-7cba-477c-9032-b0b7798eab00` completed with zero findings for the changed runtime/test files. TAC status could not be verified because the Codex Security Access connector is not connected.

## Next Recommended Slice

Next should be public profile cross-surface attribution: add opt-in public profile links to review author rows, eligible player-facing challenge/member rows, and safe leaderboard/player mentions only when a generated public profile handle exists, while keeping hidden players anonymous and proving public profile linking still cannot affect billing, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
