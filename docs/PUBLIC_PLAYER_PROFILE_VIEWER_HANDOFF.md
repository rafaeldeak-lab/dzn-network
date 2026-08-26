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

## Follow-On Public Profile Cross-Surface Attribution

The public profile cross-surface attribution slice makes opted-in public profile links available on existing public/player surfaces without making public profiles an input to ranking, billing, discovery, moderation, progression awards, or competitive eligibility.

Branch details:

- Branch: `codex/public-profile-cross-surface-attribution-20260825`
- Base branch: `codex/public-profile-discovery-linking-polish-20260825`
- Base commit: `02a2a46bb10a06dfc99b64eff74b02fe50c1f706`

This follow-on slice adds:

- A shared read-only attribution helper sourced from `player_profile_privacy_preferences` and `users`.
- Public review author links only when `server_reviews.reviewer_discord_id` resolves to an opted-in DZN user with a generated `public_handle`.
- Current-player challenge-row attribution only when the logged-in player has already published a generated public handle.
- Leaderboard player links only where the row already has a unique trusted account bridge through `player_profiles.discord_id`, `kill_events.killer_profile_id`, or `kill_events.victim_profile_id`; ambiguous aggregates and conflicting kill/death bindings render as plain names.
- Client-side link validation so only exact generated-handle `/players/...` public profile hrefs are rendered.

This follow-on slice must not infer profile links from gamertag/name matching, expose Discord IDs, expose internal user IDs, expose Discord avatar URLs, create handles, write privacy settings, mutate reviews, mutate leaderboard scores, update discovery scores, change billing or owner entitlement, award XP, award calling cards, touch Nitrado, mutate Discord resources, change Cloudflare secrets, apply production D1 writes, enable live checkout, or merge issue #49.

## Follow-On Public Profile Attribution Expansion And Controls Polish

The public profile attribution expansion and controls polish slice adds private profile-link preview controls for players and extends attribution only to newly touched public/player-safe rows that already have a trusted DZN user bridge.

Branch details:

- Branch: `codex/public-profile-attribution-expansion-controls-polish-20260825`
- Base branch: `codex/public-profile-cross-surface-attribution-20260825`
- Base commit: `6d0b45f709ac4a097aa23acab1c59875b8d4d804`

This follow-on slice adds:

- A shared `buildPublicProfileAppearancePreview` contract in the public profile attribution helper.
- `profile_attribution` preview metadata on `GET /api/player/profile`, `GET /api/player/profile-privacy`, `PATCH /api/player/profile-privacy`, and `GET /api/player/hub`.
- A private `/player/profile` panel named "Where My Public Profile Appears" with an explicit "Hide All Public Links" control tied to the existing `public_profile_enabled` setting.
- A private Player Hub summary named "Where My Profile Appears".
- Public event suggestion author links through `event_suggestions.submitted_by_user_id` only when the submitter resolves to an opted-in DZN user with a generated public handle.
- Player Hub challenge-row preview attribution for the current player's own trusted `player_state.public_profile`.

Still excluded:

- CTF/event scoring rosters.
- Event roster rows that touch scoring, eligibility, sign-up decisions, or owner workflow state.
- Owner event management rows.
- Owner/admin review tools and moderation queues.

This slice does not add migrations, custom handle editing, checkout activation, owner entitlement changes, production D1 writes, Nitrado calls, Discord mutations, Stripe mutations, Cloudflare secret changes, issue #49 changes, XP/calling-card awards, ranking updates, discovery updates, review score changes, badge awards, season changes, Server Wars scoring changes, or event mutations.

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

Completed on branch `codex/public-profile-cross-surface-attribution-20260825`:

- `npm run test:public-profile-cross-surface-attribution` passed.
- `npm run test:public-profile-discovery-linking-polish` passed.
- `npm run test:public-player-profile-viewer` passed.
- `npm run test:public-listing-reviews` passed.
- `npm run test:public-leaderboards` passed.
- `npm run test:reviews-foundation` passed.
- `npm run test:reviews-moderation-dashboard` passed.
- `npm run test:reviews-moderation-workflow-polish` passed.
- `npm run test:review-notification-read-state` passed.
- `npm run test:player-hub-foundation` passed.
- `npm run test:player-saved-servers` passed.
- `npm run test:challenges-xp-calling-cards-foundation` passed.
- `npm run test:progression-awards-foundation` passed.
- `npm run test:progression-award-source-adapters-audit` passed.
- `npm run test:player-profile-progression-showcase` passed.
- `npm run test:player-profile-privacy-preferences` passed.
- `npm run test:public-access-gating` passed.
- `npm run test:player-owner-access-foundation` passed.
- `npm run test:events` passed.
- `npm run test:server-war-scoring` passed.
- `npm run test:server-war-gating` passed.
- `npm run test:dzn-seasons` passed.
- `npm run test:billing-plans` passed using mocked/local checkout/webhook tests only.
- `npm run test:stripe-live-readiness` passed.
- `npm run test:stripe-live-activation-checklist` passed.
- `npm run check:billing-config` passed and reported live checkout disabled/not configured.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with four existing warnings outside this slice.
- `npm test` passed on the final tree. The optional latest ADM raw fixture check skipped because the owner-supplied raw bundle is not present locally.
- `git diff --check` passed.
- `npm run build` passed and exported `/leaderboards`, `/events/challenges`, `/servers/[slug]`, `/players/[handle]`, and the existing player/owner/public routes.
- Codex Security diff scan completed with zero findings. TAC status could not be verified because the Codex Security Access connector is not connected.

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

## Follow-On CTF/Event Roster Attribution Proof

Branch: `codex/ctf-event-roster-attribution-proof-20260825`

Base branch: `codex/public-profile-attribution-expansion-controls-polish-20260825`

Base commit: `4b78c73 Add public profile attribution controls polish`

This slice adds optional public profile attribution to read-only CTF dashboard roster display rows only. The trusted bridge is exact `ctf_tournament_rosters.linked_server_id` plus `ctf_tournament_rosters.player_id` to `player_profiles.discord_id`, then `users.discord_id`, then an opted-in generated `player_profile_privacy_preferences.public_handle`.

The CTF dashboard response may include optional `public_profile` metadata on roster rows and a `profile_attribution` safeguards object for the UI. The dashboard stays owner/admin-authorized; this slice does not publish CTF roster data to public users.

Still excluded:

- `POST /api/servers/[serverId]/ctf/roster` registration and roster writes.
- CTF scoring helpers, locked-roster checks, flag/point increments, and accepted scoring feed decisions.
- Event roster approvals, eligibility, sign-up, matchmaking, bracket, owner decision, moderation, and admin workflow mutations.
- Billing, owner entitlements, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, Nitrado, Discord bot mutations, Cloudflare secrets, production D1 writes, live checkout activation, and issue #49.

## Follow-On Event Roster/Member Public-Safe Expansion

Branch: `codex/event-roster-member-public-safe-expansion-20260825`

Base branch: `codex/ctf-event-roster-attribution-proof-20260825`

This slice adds opt-in public profile attribution to public event host/member display rows only. The trusted bridge is `competitive_events.created_by` to `users.id`, then an opted-in generated `player_profile_privacy_preferences.public_handle`.

The public events list, event detail response, event cards, event table rows, and server event profile cards may include or render optional `creator_profile` metadata when the creator has published their profile. The event response also carries a `profile_attribution` safeguards object with placement `public_event_creator_member_rows`, `link_mode = presentation_only`, no gamertag matching, no private identifier exposure, and no scoring, eligibility, owner-decision, or billing influence.

Still excluded:

- Registered server rows, event leaderboards, match rows, CTF scoring rows, accepted CTF audit feeds, and bracket outcomes.
- Event roster rows that touch scoring, eligibility, sign-up approvals, owner workflow state, moderation, or admin operations.
- Raw `created_by`, internal user IDs, Discord IDs, browser-supplied public handles, and gamertag-derived identity.
- Billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, Nitrado, Discord bot mutations, Cloudflare secrets, production D1 writes, live checkout activation, and issue #49.

## Follow-On Public-Safe Community Member Directory Foundation

Branch: `codex/community-member-directory-foundation-20260826`

Base branch: `codex/event-roster-member-public-safe-expansion-20260825`

This slice adds the first dedicated public-safe community/player-member directory. It introduces the additive `community_members` bridge so DZN can show public profile links only after there is a unique trusted DZN user bridge from a linked server community to `users.id`.

This follow-on slice adds:

- `migrations/0067_community_member_directory_foundation.sql` with unique `(community_guild_id, user_id)` membership tied to `discord_guilds.id` and `users.id`.
- `GET /api/public/servers/[serverId]/community-members` as a public-safe, read-only directory payload.
- `/servers/[slug]/community` as the public community member page, with a Pages shell for arbitrary server slugs.
- Server card/profile navigation to the community member directory.
- `public_community_member_directory` in the public profile attribution preview/control metadata.

The trusted bridge is `community_members.community_guild_id` plus `community_members.user_id` to `users.id`, then an opted-in generated `player_profile_privacy_preferences.public_handle`. The page and API show only `public_member_enabled = 1`, `source = 'trusted_dzn_bridge'` members with valid generated public profile hrefs.

Still excluded:

- CTF scoring rows, accepted scoring feeds, locked roster checks, point progression, flag raises, and bracket outcomes.
- Owner workflow rows, community-member source/import writes, approval decisions, moderation authority, Nitrado linking, and Discord bot mutations.
- Raw community guild IDs, raw user IDs, Discord IDs, OAuth tokens, server ownership state, billing state, approval state, scoring state, raw award evidence, and owner workflow state.
- Billing, rankings, discovery score, reviews, review score, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, Nitrado, Discord bot mutations, Cloudflare secrets, production D1 writes, live checkout activation, and issue #49.

## Next Recommended Slice

Next should be trusted community member source management and audit: add owner/admin-only controls to review or import candidate community members into the `community_members` bridge, with explicit audit history, duplicate/ambiguous-user rejection, and tests proving those source-management actions cannot affect public profile visibility without the player's opt-in handle, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Follow-On Community Member Directory and Player Hub Surfacing Polish

Branch: `codex/community-member-directory-player-hub-polish-20260826`

Base branch: `codex/community-member-retained-export-approval-design-20260826`

This slice polishes the public-safe community member directory and the free logged-in Player Hub without adding retained exports, new storage, billing behavior, scoring inputs, or public profile publication writes.

The slice adds:

- `community_href` to Player Hub server summaries so matched, saved, and suggested servers can link directly to `/servers/[slug]/community`.
- A Player Hub "Community Member Directories" section and direct "Members" actions on matched community/server cards.
- Public directory search and role filtering against already-public profile rows only.
- Public community URL copy/share controls for the public directory page only.
- Clear public-safe empty states for hidden or not-yet-opted-in members.
- Owner/admin "Public directory status" previews on source candidate cards.
- `public_directory_preview_presentation_only` in the source-management safeguards.

Still excluded:

- Retained export files, export-history rows, export sharing links, storage bindings, retention write APIs, retained-export migrations, live checkout activation, Stripe product/price changes, Cloudflare secret changes, production D1 writes, Nitrado calls, Discord mutations, and issue #49.
- Public profile visibility without the player's opt-in generated handle.
- CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.

## Next Recommended Slice

Next should be community member directory discovery/search polish for public visitors: add richer public sorting/grouping and server/community context cards for already-visible members only, while continuing to keep hidden players private, owner/admin import controls gated, retained exports blocked unless separately approved, live checkout disabled, and all scoring, billing, rankings, reviews, badges, seasons, Server Wars, XP, calling-card awards, and competitive eligibility isolated.
