# Community Member Import Export Workflow Polish Handoff

Branch: `codex/community-member-import-export-workflow-polish-20260826`
Base: `codex/community-member-import-audit-history-polish-20260826` at `31debf55ab4748aed20fa405c796532b59f71be7`

This slice adds a bounded downloadable export action for the existing export-safe community member import audit rows. It builds on the private owner/admin source-management dashboard, audit action/result filters, audit grouping, and export-safe read model. It does not change public profile publishing, checkout, billing plans, owner entitlement rules, Stripe configuration, Cloudflare secrets, production D1, Nitrado, Discord resources, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Added

- `functions/_lib/community-member-source-management.ts`
  - Adds `exportCommunityMemberSourceAudit`.
  - Adds `CommunityMemberSourceAuditExport` and `CommunityMemberSourceAuditExportFilters`.
  - Adds server-side `date_from`, `date_to`, `audit_action`, `audit_result`, `linked_server_id`, and `limit` export filters.
  - Adds `buildCommunityMemberSourceAuditCsv` for CSV output from export-safe rows only.
  - Bounds CSV exports with `MAX_EXPORT_LIMIT`.
  - Fetches one extra scoped audit row to report whether the export was truncated.
  - Uses stable hashed export-safe refs instead of raw internal IDs for downloadable rows.
  - Adds safeguards for `bounded_export_downloads`, `export_download_private_owner_admin_only`, `export_filters_action_result_date`, and `export_uses_export_safe_audit_rows`.

- `functions/api/owner/community-members/export.ts`
  - Adds `GET /api/owner/community-members/export`.
  - Authorizes through `authorizeCommunityMemberSourceRequest` before generating the export.
  - Returns a private no-store CSV attachment.
  - Sets export metadata headers for row count, row limit, truncation, and export-safe status.
  - Rejects non-GET methods.

- `components/community/community-member-source-dashboard.tsx`
  - Adds `Export from`, `Export to`, and `Export rows` controls.
  - Adds `Download audit CSV`.
  - Uses the selected linked community, audit action, audit result, date filters, and server-side row limit when downloading.
  - Shows dashboard safeguard lines for bounded export downloads and export action/result/date filters.

- `scripts/test-community-member-source-management-audit.ts`
  - Adds static contracts for the export helper, route, UI controls, docs, and package script.
  - Adds runtime coverage for sanitized CSV output, date/action/result filters, bounded truncation, route attachment headers, route private no-store headers, and protected-system isolation.

## Access Contract

- Logged-out visitors cannot download community member import audit exports.
- Free logged-in players cannot download community member import audit exports.
- Normal owners must pass the canonical owner entitlement boundary.
- Normal owners can export only audit rows tied to their own linked servers.
- Configured DZN admins can export the admin-scoped source audit queue.
- Export filters are applied after owner/admin scope and cannot widen access.

## Export Contract

- `/api/owner/community-members/export` is a private owner/admin route, not a public API.
- The route returns `text/csv; charset=utf-8` with `content-disposition: attachment`.
- The CSV is generated only from existing `export_safe_audit` rows.
- The CSV contains export-safe owner/admin rows only.
- The request supports:
  - `linked_server_id`
  - `audit_action`
  - `audit_result`
  - `date_from`
  - `date_to`
  - `limit`
- `date_from` and `date_to` accept `YYYY-MM-DD` or valid ISO date/time values.
- Invalid dates and reversed ranges return a private JSON error.
- Export row count is bounded server-side.
- The route returns `x-dzn-export-safe`, `x-dzn-export-row-count`, `x-dzn-export-limit`, and `x-dzn-export-truncated`.
- Downloadable rows must not expose raw actor user IDs, raw Discord IDs, raw community guild IDs, raw linked-server IDs, raw DZN user IDs, OAuth tokens, billing state, scoring state, private award evidence, Nitrado state, Discord bot state, or Stripe state.

## Mutation Contract

This slice adds no new database writes.

Allowed behavior:

- Read already-scoped `community_member_source_audit` rows.
- Build export-safe audit rows from the existing sanitizer.
- Return a private CSV response to the authenticated owner/admin.

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

Public visibility remains player-controlled. Export downloads cannot make a player visible unless that player has enabled public profile visibility and already has a generated `player_profile_privacy_preferences.public_handle`.

## Fairness

Community member import export workflow polish is an owner/admin artifact workflow only. It must not affect:

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

- `npm run test:community-member-import-export-workflow-polish`
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

Next should be community member export UX and retention controls: add owner/admin export history affordances that clarify when an export was generated, which filters were applied, and when the downloaded artifact should be treated as private, while keeping exports bounded, private, non-persistent by default, and isolated from public profile visibility without player opt-in, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.
