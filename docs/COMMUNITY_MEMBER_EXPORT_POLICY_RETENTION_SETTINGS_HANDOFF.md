# Community Member Export Policy and Optional Retention Settings Handoff

Branch: `codex/community-member-export-policy-retention-settings-20260826`
Base: `codex/community-member-export-ux-retention-controls-20260826` at `4e6dd8203d4638886bf5c340c5827ecf1838ea57`

This slice adds an owner/admin-visible export policy surface and a locked optional retention settings display for community member audit exports. It does not approve or implement persistent export retention. Exports remain private, bounded, download-only, and non-persistent by default.

## Added

- `functions/_lib/community-member-source-management.ts`
  - Adds `CommunityMemberSourceExportPolicy`.
  - Adds `communityMemberSourceExportPolicy`.
  - Adds `export_policy` to the owner/admin community member source-management payload.
  - Adds `policy` to `exportCommunityMemberSourceAudit`.
  - Adds safeguards for the owner/admin-visible policy surface, explained download rules, disabled persistent retention settings, required expiry/audit controls if retention is ever approved, and no storage side effect.

- `functions/api/owner/community-members/export.ts`
  - Keeps the route `GET` only.
  - Keeps `authorizeCommunityMemberSourceRequest` before export generation.
  - Keeps the private no-store CSV attachment behavior.
  - Adds export policy response headers:
    - `x-dzn-export-policy`
    - `x-dzn-export-persistent-retention`
    - `x-dzn-export-retention-expiry-required-if-approved`
    - `x-dzn-export-retention-audit-required-if-approved`

- `components/community/community-member-source-dashboard.tsx`
  - Adds an owner/admin-visible export policy surface.
  - Shows current export handling rules beside the export controls.
  - Shows max download rows and the client-session recent export history limit.
  - Shows that stored export files and shared export links are off.
  - Adds `Optional retention settings` as a locked display.
  - Shows persistent retention is disabled and requires explicit approval.
  - Shows expiry and audit controls are required before any future persistent retention model.
  - Keeps recent export history in component state only and bounded to five entries.

- `scripts/test-community-member-source-management-audit.ts`
  - Adds static contract coverage for the export policy helper, payload, route headers, dashboard labels, package script, platform spec, public access policy, and this handoff.
  - Adds runtime coverage that `communityMemberSourceExportPolicy` reports download-only retention, no DZN-persisted export files, client-session dashboard history, no sharing links, and persistent retention status `not_approved`.
  - Adds checks that no persistent retention table, export storage write, browser storage write, profile visibility mutation, or protected-system write is introduced.

## Access Contract

- Logged-out visitors cannot see the export policy surface or download community member audit exports.
- Free logged-in players cannot see the export policy surface or download community member audit exports.
- Normal owners must pass the canonical owner entitlement boundary.
- Normal owners can see the policy surface only in the owner/admin community member dashboard and only for their scoped owner context.
- Configured DZN admins can see the same policy surface for the admin-scoped queue.
- Export filters are still applied after owner/admin scope and cannot widen access.

## Current Retention Contract

- Export retention is `download_only`.
- Export files are private owner/admin artifacts.
- DZN does not persist export files by default.
- DZN does not persist export-history records by default.
- Dashboard recent export history is client-session-only React state.
- Dashboard recent export history is bounded to five entries.
- Dashboard recent export history can be cleared locally.
- Stored export files are off.
- Shared export links are off.
- Browser persistence is off.
- No export-retention setting write API exists in this slice.

## Optional Retention Settings Contract

Persistent export retention is disabled in this slice. A future retained-export model requires explicit approval before implementation.

If later approved, that future model must include:

- A separate owner/admin-scoped retention model.
- Expiry on every retained export.
- Actor, scope, filter, and result audit controls.
- Export-safe rows only.
- No raw Discord IDs, raw DZN user IDs, raw linked-server IDs, or raw community guild IDs in retained export artifacts.
- A separate migration and security review before any stored artifact or sharing link exists.

## Mutation Contract

Allowed behavior:

- Read already-scoped `community_member_source_audit` rows.
- Return a private no-store CSV response to the authenticated owner/admin.
- Return policy metadata in the owner/admin source-management payload and CSV response headers.
- Keep temporary recent export metadata in the current dashboard component state after a successful download.

Forbidden behavior:

- Persistent export-retention tables or writes.
- Stored export files.
- Export sharing links.
- Browser storage writes.
- Public export routes.
- Retention setting save APIs.
- `player_profile_privacy_preferences` writes.
- CTF scoring/roster/bracket writes.
- owner workflow/approval decision writes.
- billing/Stripe/plan writes.
- ranking/discovery writes.
- review/review-score writes.
- badge/season/event/Server Wars scoring writes.
- XP/calling-card/challenge award writes.
- Nitrado, Discord, Cloudflare secret, or production D1 mutation.

## Fairness

Community member export policy and optional retention settings are owner/admin governance and presentation aids only. They must not affect:

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

- `npm run test:community-member-export-policy-retention-settings`
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
- `npm test`
- `git diff --check`

## Next Slice

Next should be community member export policy review and admin guardrails: add admin-only policy review affordances that confirm the current export defaults across all owner scopes and flag any future retained-export work as blocked until a dedicated approval, migration, expiry model, storage plan, and security review exist.
