# Community Member Export UX and Retention Controls Handoff

Branch: `codex/community-member-export-ux-retention-controls-20260826`
Base: `codex/community-member-import-export-workflow-polish-20260826` at `65c90b88ebf93223a23f80093e7d1e82837d06b2`

This slice improves the owner/admin community member import audit export UX without changing the export data model. It adds client-session-only recent export history, clearer private-artifact labels, and download-only retention metadata while keeping exports bounded, private, non-persistent by default, and isolated from public profile visibility, scoring, billing, rankings, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, and competitive eligibility.

## Added

- `functions/_lib/community-member-source-management.ts`
  - Adds `CommunityMemberSourceAuditExportRetention`.
  - Adds `communityMemberSourceAuditExportRetention`.
  - Adds explicit retention metadata to `exportCommunityMemberSourceAudit`.
  - Adds safeguards for client-only export history, private artifact notices, non-persistent default export downloads, and retention controls.

- `functions/api/owner/community-members/export.ts`
  - Keeps the route `GET` only.
  - Keeps `authorizeCommunityMemberSourceRequest` before export generation.
  - Adds export response headers for generated time, artifact privacy, retention mode, DZN persistence status, and dashboard history mode:
    - `x-dzn-export-generated-at`
    - `x-dzn-export-artifact`
    - `x-dzn-export-retention`
    - `x-dzn-export-persisted-by-dzn`
    - `x-dzn-export-dashboard-history`

- `components/community/community-member-source-dashboard.tsx`
  - Adds a visible `Private export` panel.
  - Adds client-session-only recent export history after successful downloads.
  - Shows when each export was generated.
  - Shows the selected community, action, result, date range, and row limit used for each downloaded file.
  - Marks downloaded files as private owner/admin artifacts.
  - Shows that DZN does not persist the export file or export history record by default.
  - Adds `Clear local history` to remove the in-dashboard history affordance.

- `scripts/test-community-member-source-management-audit.ts`
  - Adds static contracts for the new retention metadata, route headers, dashboard labels, package script, public access policy, master spec, and this handoff.
  - Adds runtime coverage that export retention remains `download_only`, not persisted by DZN, private, and client-session-only.
  - Adds checks that no persistent export-history table, browser storage, profile visibility mutation, or protected-system write is introduced.

## Access Contract

- Logged-out visitors cannot download or view export history affordances.
- Free logged-in players cannot download or view owner/admin export history affordances.
- Normal owners must pass the canonical owner entitlement boundary.
- Normal owners can download and see current-session recent export metadata only for their scoped owner/admin dashboard actions.
- Configured DZN admins can use the same private affordance for the admin-scoped queue.
- Export filters are still applied after owner/admin scope and cannot widen access.

## Retention Contract

- Export retention is `download_only`.
- The downloaded CSV is a private owner/admin artifact.
- DZN does not persist a separate export file by default.
- DZN does not persist a separate export-history database record by default.
- The dashboard recent export history is client-session-only React state.
- The dashboard recent export history is bounded to five entries.
- The dashboard recent export history can be cleared locally.
- This slice does not use `localStorage`, `sessionStorage`, IndexedDB, cookies, R2, KV, D1 export-history rows, public sharing links, or any persistent export archive.
- The underlying `community_member_source_audit` rows remain the durable source audit history.

## Mutation Contract

Allowed behavior:

- Read already-scoped `community_member_source_audit` rows.
- Return a private no-store CSV response to the authenticated owner/admin.
- Keep temporary recent export metadata in the current dashboard component state after a successful download.

Forbidden writes:

- Persistent export-history rows or stored export files
- `player_profile_privacy_preferences`
- CTF scoring/roster/bracket tables
- owner workflow/approval decision tables
- billing/Stripe/plan tables
- ranking/discovery tables
- review/review score tables
- badge/season/event/Server Wars scoring tables
- XP/calling-card/challenge award tables
- Nitrado/Discord/Cloudflare secret state

## Fairness

Community member export UX and retention controls are owner/admin presentation aids only. They must not affect:

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

- `npm run test:community-member-export-ux-retention-controls`
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

Next should be community member export policy and optional retention settings: add an owner/admin-visible policy surface for export handling rules and, only if explicitly approved, design a separate persistent export-retention model with expiry and audit controls. Until that slice is deliberately approved, exports remain download-only, private, bounded, and non-persistent by default.
