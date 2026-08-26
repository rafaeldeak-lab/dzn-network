# Community Member Import Audit-History Polish Handoff

Branch: `codex/community-member-import-audit-history-polish-20260826`
Base: `codex/community-member-import-workflow-execution-polish-20260826` at `3db6477594f967ba12619ec0c1ca7a81cee5bdf2`

This slice adds clearer owner/admin audit-history polish for community member import execution. It builds on selected-row bulk import/reject, private import-alert read state, and export-safe owner/admin audit views. It does not change public profile publishing, checkout, billing plans, owner entitlement rules, Stripe configuration, Cloudflare secrets, production D1, Nitrado, Discord resources, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Added

- `functions/_lib/community-member-source-management.ts`
  - Adds per-candidate execution summaries for `bulkActOnCommunityMemberCandidates`.
  - Adds `execution_summaries` for per-candidate bulk outcomes.
  - Adds a bulk `summary` object for requested, processed, imported, rejected, blocked, failed, and partial success counts.
  - Adds `audit_action` and `audit_result` filters on the private source-management list payload.
  - Adds `audit_groups` for filterable bulk action audit grouping over already-scoped audit rows.
  - Adds `export_safe_audit` rows that omit raw actor user IDs, raw Discord IDs, raw community guild IDs, raw linked-server IDs, and raw DZN user IDs.
  - Adds safeguards for `bulk_partial_success_execution_summaries`, `filterable_bulk_action_audit_groups`, and `export_safe_audit_views`.

- `functions/api/owner/community-members.ts`
  - Reads `audit_action` and `audit_result` from the private owner/admin GET query.
  - Keeps authorization before payload loading.
  - Keeps private no-store responses.

- `components/community/community-member-source-dashboard.tsx`
  - Shows `Bulk action summaries` after bulk import/reject execution, including imported/rejected/blocked/failed outcomes per selected candidate.
  - Adds `Audit action` and `Audit result` filters.
  - Shows filterable audit group cards for related source-audit rows.
  - Shows an `Export-safe audit view` for owner/admin review without raw private identifiers.

- `scripts/test-community-member-source-management-audit.ts`
  - Adds static contracts for the new helper types, response fields, dashboard controls, docs, and package script.
  - Adds runtime coverage for mixed bulk partial success, per-candidate summaries, filtered audit reads, grouped audit rows, export-safe audit rows, and protected-system isolation.

## Access Contract

- Logged-out visitors cannot use these APIs or dashboard pages.
- Free logged-in players cannot use community member source-management actions.
- Normal owners must pass the canonical owner entitlement boundary.
- Normal owners can read or act only on candidate/audit rows tied to their own linked servers.
- Configured DZN admins can read the global owner/admin source-management queue.
- Audit filters are applied after owner/admin scoping; they do not widen access.

## Export-Safe Audit Contract

- `export_safe_audit` is a private owner/admin read model, not a public API.
- It includes action, result, role, server/community display names, public server slug where present, safe compact references, reason, and timestamp.
- It omits raw actor user IDs, raw Discord IDs, raw community guild IDs, raw linked-server IDs, raw DZN user IDs, OAuth tokens, billing state, scoring state, private award evidence, Nitrado state, Discord bot state, and Stripe state.
- The existing detailed private audit rows remain available to the owner/admin dashboard for operational review.

## Mutation Contract

Allowed writes are unchanged from the workflow execution slice:

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

Public visibility remains player-controlled. Bulk summaries, audit grouping, and export-safe audit views cannot make a player visible unless that player has enabled public profile visibility and already has a generated `player_profile_privacy_preferences.public_handle`.

## Fairness

Community member import audit-history polish is an owner/admin presentation workflow only. It must not affect:

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

- DZN_LIVE_CHECKOUT_ENABLED remains disabled.
- No Stripe products/prices were created or changed.
- No Cloudflare secrets were created or changed.
- No production D1 migration was applied.
- No Nitrado mutation was performed.
- No Discord mutation was performed.
- Issue #49 remains reserved for final live checkout activation.
- Production merge/deploy/migration application: not included.

## Validation

Run before PR handoff:

- `npm run test:community-member-import-audit-history-polish`
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

Next should be owner/admin community member import export workflow polish: add a bounded downloadable export action for the existing export-safe audit rows, include clear date/action/result filters in the export request, and keep proving exports remain private owner/admin artifacts that cannot affect public profile visibility without player opt-in, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.
