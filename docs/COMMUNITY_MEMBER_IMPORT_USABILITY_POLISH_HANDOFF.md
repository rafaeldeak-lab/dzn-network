# Community Member Import Usability Polish Handoff

Branch: `codex/community-member-import-usability-polish-20260826`
Base: `codex/community-member-source-management-audit-20260826` at `b1f5c32b49bc19c073445e1beadff8b539027aa6`

This slice improves the owner/admin community member source-management queue with safer import previews, trusted Discord/guild snapshot context where available, repeated no-match and repeated duplicate admin filters, and a private owner DZN Pulse notification hook when a source candidate becomes importable. It remains a presentation-only source review workflow. It does not change public profile publishing, live checkout, billing plans, Stripe configuration, Cloudflare secrets, production D1, Nitrado, Discord resources, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Added

- `migrations/0069_community_member_import_usability_polish.sql`
  - Adds additive `community_member_source_snapshots` preview rows for trusted Discord/guild snapshot evidence.
  - Adds lookup indexes for snapshot previews.
  - Adds an additive partial lookup index for `community_member_candidate_importable` DZN Pulse notifications.
  - Keeps the migration additive only.

- `functions/_lib/community-member-source-management.ts`
  - Adds import-preview status for pending, matched, no-match, duplicate, ambiguous, imported, and rejected candidates.
  - Reads trusted snapshot preview context from `community_member_source_snapshots` when linked server, community guild, and candidate Discord ID match.
  - Adds `refresh_preview` so a candidate can become importable after a player later logs in and creates the unique DZN user bridge.
  - Adds `importable`, repeated no-match, and repeated duplicate issue filters.
  - Writes `candidate_preview_refreshed` and `candidate_importable` source audit rows.
  - Creates private `community_member_candidate_importable` owner notifications through DZN Pulse only.
  - Keeps notification metadata free of raw candidate Discord IDs.

- `functions/_lib/dzn-pulse.ts`
  - Adds the `community_member_candidate_importable` notification type.
  - Adds the `community` DZN Pulse category/filter.
  - Reuses the existing DZN Pulse enabled flag and notification storage path.

- `functions/api/owner/community-members.ts`
  - Accepts the `issue` queue filter for importable, repeated no-match, and repeated duplicate source rows.

- `components/community/community-member-source-dashboard.tsx`
  - Adds import preview panels.
  - Adds trusted snapshot preview display.
  - Adds refresh preview action.
  - Adds issue filters for importable, repeated no-match, and repeated duplicate rows.
  - Shows source-management safeguards for player opt-in, trusted previews, DZN Pulse owner hooks, and competitive isolation.

- `scripts/test-community-member-source-management-audit.ts`
  - Extends the existing focused test to cover this polish slice.
  - Verifies snapshot-backed no-match preview, later preview refresh into importable state, private owner notification creation, repeated no-match filtering, repeated duplicate filtering, and public profile privacy isolation.

## Access Contract

- Logged-out visitors receive protected page/API behavior through the existing owner/admin boundaries.
- Free logged-in players remain free players and cannot access source import management unless they become entitled owners or configured DZN admins.
- Normal owners must pass the canonical owner entitlement boundary before using source import APIs.
- Normal owners may manage and receive importable notifications only for their own linked servers.
- Configured DZN admins may inspect and manage global source rows through the same API.
- A paid plan does not let an owner manage another owner's linked server.

## Import Preview Contract

- Import readiness requires:
  - a pending candidate,
  - exactly one trusted DZN user bridge,
  - no existing `community_members` row for `(community_guild_id, user_id)`.
- Trusted Discord/guild snapshot previews are context only. They do not replace the DZN user bridge.
- No-match candidates can be stored and reviewed, but import remains blocked until a unique DZN user bridge exists.
- Duplicate and ambiguous candidates remain blocked and audited.
- `refresh_preview` may update candidate preview/match state, but it must not create profile privacy preferences or public profile handles.

## Notification Contract

- `community_member_candidate_importable` notifications may be written only to `user_notifications`.
- Notifications are created for the linked-server owner when a candidate transitions into importable state.
- Notifications use DZN Pulse only; this slice does not send Discord messages or mutate Discord guild resources.
- Notification metadata must not include raw candidate Discord IDs.
- Notification read state remains private to the owner/admin user and does not change candidate importability.

## Mutation Contract

Allowed writes:

- `community_member_source_snapshots` schema only
- `community_member_candidates` preview/match refresh fields
- `community_member_source_audit`
- `community_members` only for imported rows with `source = 'trusted_dzn_bridge'`
- `user_notifications` only for private `community_member_candidate_importable` DZN Pulse notifications

Forbidden writes:

- `player_profile_privacy_preferences`
- CTF scoring/roster/bracket tables
- owner workflow/approval decision tables
- billing/Stripe/plan tables
- ranking/discovery tables
- review/review score tables
- badge/season/event/Server Wars scoring tables
- XP/calling-card/challenge award tables
- Nitrado/Discord/Cloudflare secret state

Public visibility remains player-controlled. Import previews, refreshes, filters, and owner notifications cannot make a player visible unless that player has enabled public profile visibility and already has a generated `player_profile_privacy_preferences.public_handle`.

## Fairness

Community member import usability is an owner/admin presentation bridge workflow only. It must not affect:

- public profile visibility without player opt-in
- CTF scoring rows
- owner workflow decisions
- approval decisions
- bracket outcomes
- billing
- rankings
- discovery score
- reviews or review score
- badges
- seasons
- events or tournaments
- Server Wars scoring/results
- XP awards
- calling-card awards
- competitive eligibility

## Production Safety

- `DZN_LIVE_CHECKOUT_ENABLED` remains disabled.
- No Stripe products/prices were created or changed.
- No Cloudflare secrets were created or changed.
- No production D1 migration was applied.
- No Nitrado mutation was performed.
- No Discord mutation was performed.
- Issue #49 remains reserved for final live checkout activation.
- Production merge/deploy/migration application: not included.

## Validation

Run before PR handoff:

- `npm run test:community-member-import-usability-polish`
- `npm run test:community-member-source-management-audit`
- `npm run test:public-community-member-directory-foundation`
- `npm run test:public-profile-attribution-controls-polish`
- `npm run test:public-profile-cross-surface-attribution`
- `npm run test:public-player-profile-viewer`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:review-notification-read-state`
- `npm run test:ctf-event-roster-attribution-proof`
- `npm run test:event-roster-member-public-safe-expansion`
- `npm run test:dzn-pulse`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --pretty false --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Next Slice

Next should be community member import workflow execution polish: add owner/admin queue actions that build on the safer previews, such as selected-row bulk reject/import review where every row still rechecks the trusted DZN user bridge server-side, private notification read/unread controls for importable community-member alerts, and UI tests proving cross-owner denial and presentation-only isolation from public profile visibility, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
