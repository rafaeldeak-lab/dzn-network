# Community Member Import Workflow Execution Polish Handoff

Branch: `codex/community-member-import-workflow-execution-polish-20260826`
Base: `codex/community-member-import-usability-polish-20260826` at `64e5d3754dd0f3743db93320cb8c2dd53ee5d027`

This slice adds selected-row bulk import/reject execution and private read/unread controls for `community_member_candidate_importable` alerts. It builds only on the trusted owner/admin community member source-management queue. It does not change public profile publishing, live checkout, billing plans, Stripe configuration, Cloudflare secrets, production D1, Nitrado, Discord resources, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Added

- `functions/_lib/community-member-source-management.ts`
  - Adds `bulkActOnCommunityMemberCandidates`.
  - Caps selected-row bulk actions to a bounded request size.
  - Reuses `actOnCommunityMemberCandidate` for every selected row so the server rechecks owner/admin scope, pending/rejected/imported state, exact DZN user bridge, duplicate community-member state, and audit writes per row.
  - Adds private `notification_counts` to the owner/admin payload for total unread Pulse alerts and unread `community_member_candidate_importable` alerts.
  - Tightens reject actions so only pending candidates can be rejected from review.

- `functions/_lib/dzn-pulse.ts`
  - Adds `countUnreadCommunityMemberImportNotifications`.
  - Adds `markCommunityMemberImportNotificationsRead`.
  - Adds `communityMemberImportNotificationConditionSql`.
  - Marks only active `community_member_candidate_importable` rows read for the authenticated owner/admin user.

- `functions/api/owner/community-members/bulk.ts`
  - Adds `POST /api/owner/community-members/bulk`.
  - Route contract: `/api/owner/community-members/bulk`.
  - Authenticates before reading the request body.
  - Uses bounded JSON parsing and private no-store responses.

- `functions/api/owner/community-members/notifications/read.ts`
  - Adds `POST /api/owner/community-members/notifications/read`.
  - Route contract: `/api/owner/community-members/notifications/read`.
  - Authenticates through the same owner/admin community member source boundary.
  - Clears only the current user's active community-member import alerts.

- `components/community/community-member-source-dashboard.tsx`
  - Adds pending-row selection.
  - Adds `Bulk import selected` and `Bulk reject selected`.
  - Adds a visible warning that every selected row is rechecked server-side.
  - Adds import-alert counts and `Mark import alerts read`.
  - Keeps non-pending rows out of bulk selection.

- `scripts/test-community-member-source-management-audit.ts`
  - Adds static contracts for the new routes, helper functions, dashboard controls, docs, and package script.
  - Adds runtime coverage for bulk import, bulk reject, cross-owner denial, per-row bridge rechecks, private import-alert read state, and protected-system isolation.

## Access Contract

- Logged-out visitors cannot use the community member source-management APIs.
- Free logged-in players remain free players and cannot use these owner/admin source-management actions.
- Normal owners must pass the canonical owner entitlement boundary.
- Normal owners may bulk process only candidates tied to their own linked servers.
- Configured DZN admins may process the global queue.
- Browser-selected candidate IDs are hints only. The server re-reads and rechecks each selected row before importing or rejecting it.

## Notification Contract

- `community_member_candidate_importable` alerts are private DZN Pulse rows.
- Importable alerts are counted in the owner/admin community member source-management payload.
- `POST /api/owner/community-members/notifications/read` marks only active `community_member_candidate_importable` alerts read for the authenticated owner/admin user.
- The read action does not clear another owner's alerts.
- The read action does not clear unrelated general Pulse alerts.
- The read action does not change candidate importability, public profile visibility, billing, ranking, review, event, season, Server Wars, XP, or calling-card state.

## Mutation Contract

Allowed writes:

- `community_member_candidates` review/import state
- `community_member_source_audit`
- `community_members` only for imported rows with `source = 'trusted_dzn_bridge'`
- `user_notifications.read_at` only for the current user's active `community_member_candidate_importable` alerts

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

Public visibility remains player-controlled. Importing or rejecting source rows and marking import alerts read cannot make a player visible unless that player has enabled public profile visibility and already has a generated `player_profile_privacy_preferences.public_handle`.

## Fairness

Community member import workflow execution polish is an owner/admin presentation workflow only. It must not affect:

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

- `npm run test:community-member-import-workflow-execution-polish`
- `npm run test:community-member-import-usability-polish`
- `npm run test:community-member-source-management-audit`
- `npm run test:public-community-member-directory-foundation`
- `npm run test:event-roster-member-public-safe-expansion`
- `npm run test:ctf-event-roster-attribution-proof`
- `npm run test:public-profile-attribution-controls-polish`
- `npm run test:public-profile-cross-surface-attribution`
- `npm run test:public-player-profile-viewer`
- `npm run test:player-profile-privacy-preferences`
- `npm run test:reviews-foundation`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:reviews-moderation-workflow-polish`
- `npm run test:review-notification-read-state`
- `npm run test:player-owner-access-foundation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Next Slice

Next should be community member import audit-history polish: add clearer per-candidate execution summaries for bulk partial success, filterable bulk action audit grouping where useful, and owner/admin export-safe audit views, while still keeping imports presentation-only and proving they cannot affect public profile visibility without player opt-in, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
