# Community Member Retained Export Approval Design Handoff

## Scope

This slice adds a design-only retained-export approval model for community member audit exports. It deliberately stops before implementation.

No retained export files were implemented. No export-history rows were implemented. No sharing links were implemented. No retention write APIs were implemented. No storage binding, migration file, retained export download route, or retention save control was added.

Current exports remain private, bounded, download-only, and non-persistent by default.

## Approval Authority

Retained exports can be approved only by the DZN platform owner.

Required review roles:

- security reviewer
- data retention owner

Approval must be recorded in a dedicated retained-export approval issue or PR. That approval record must be separate from issue #49 because issue #49 remains reserved for final live checkout activation.

Owners cannot self-approve retained exports. Configured admins cannot enable retained exports from a dashboard toggle. The current dashboard can only show the blocked design requirements.

## Migration Shape

No migration was added in this slice. If retained exports are deliberately approved later, the proposed migration filename is:

- `future_retained_community_member_audit_exports.sql`

Proposed future tables:

- `community_member_retained_export_policies`: owner/admin-scoped approval and disabled-by-default policy state.
- `community_member_retained_exports`: private retained export metadata, including actor, scope, filters, row count, object key, checksum, `expires_at`, `deleted_at`, and delete reason.
- `community_member_retained_export_access_audit`: private audit history for create, download, expire, delete, deny, disable, and failure decisions.

The migration must not exist until the dedicated approval, expiry model, storage plan, rollback plan, and security review are complete.

## Expiry Model

Future retained exports, if approved, must use:

- 7-day default retention.
- 30-day maximum retention.
- Required `expires_at` on every retained export.
- Download denial for expired, deleted, disabled, or out-of-scope retained exports.
- cron-secret-only deletion or expiry jobs.
- Tombstone metadata after deletion, without preserving a downloadable file.

## Storage Plan

Future retained export storage, if approved, must use a private R2 bucket.

Proposed binding:

- `COMMUNITY_MEMBER_EXPORTS_BUCKET`

Storage rules:

- Public buckets are prohibited.
- Public URLs are prohibited.
- Unauthenticated sharing links are prohibited.
- Signed downloads must recheck owner/admin auth, linked-server scope, expiry, deletion state, and approval state.
- Persisted payloads must be export-safe CSV rows only.
- Raw Discord IDs, raw DZN user IDs, raw linked-server IDs, raw community guild IDs, OAuth tokens, Nitrado tokens, Stripe secrets, raw award evidence, scoring state, and private public-profile settings are prohibited.

## Security review checklist

- Confirm owner/admin scope before retained export creation, listing, download, expiry, and deletion.
- Confirm cross-owner denial for retained export metadata and storage object access.
- Confirm retained payloads contain export-safe CSV rows only.
- Confirm no raw Discord, DZN user, linked-server, or community guild identifiers are exposed.
- Confirm no public URLs, public bucket access, or unauthenticated sharing links exist.
- Confirm retained export creation cannot write billing, ranking, review, profile visibility, scoring, award, season, badge, event, or eligibility state.
- Confirm expiry, deletion, tombstone, and rollback behavior before any migration is applied.
- Confirm no Cloudflare secret, production D1, Nitrado, Discord, Stripe product/price, or live checkout mutation is needed for design review.

## Rollback rules

- Disable retained export creation before any retained-export data rollback.
- Keep the current download-only export path available as fallback.
- Deny downloads for disabled, deleted, expired, or out-of-scope retained exports.
- Delete retained export objects before removing storage bindings.
- Tombstone deleted export metadata for audit without preserving downloadable files.
- Prove rollback does not change public profile visibility, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, events, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Proof requirements

Before any retained-export implementation is allowed, the future slice must prove:

- Dedicated approval record exists and names the DZN platform owner approver plus security reviewer.
- Migration review proves exact table shape, indexes, foreign keys, expiry fields, and rollback path before apply.
- Storage review proves private R2 bucket only, no public bucket, no public URL, and no unauthenticated sharing link.
- API tests prove owner/admin scope, cross-owner denial, expired-download denial, deleted-download denial, disabled-policy denial, and admin-only policy visibility.
- Mutation scans prove no live checkout activation, Stripe product or price change, Cloudflare secret change, production D1 write, Nitrado call, Discord mutation, or issue #49 merge.
- Isolation tests prove retained exports cannot affect public profile visibility without player opt-in, CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

## Implementation Summary

- `functions/_lib/community-member-source-management.ts`
  - Adds `CommunityMemberRetainedExportApprovalDesign`.
  - Adds `retained_export_approval_design` under the admin-only `export_policy_review` payload.
  - Adds design-only safeguards for platform-owner approval, security review, no migration side effect, no storage side effect, no write API, blocked implementation, and issue #49 reservation.

- `components/community/community-member-source-dashboard.tsx`
  - Adds an admin-only retained-export approval design panel.
  - Shows approval authority, dedicated issue/PR requirement, proposed migration filename, expiry defaults, private R2 direction, no-public-URL rule, no-admin-toggle rule, security review checklist, proof requirements, and rollback rules.
  - Does not add a save button, toggle, retained export route, browser persistence, or storage call.

- `scripts/test-community-member-source-management-audit.ts`
  - Adds runtime and static assertions for the retained-export approval design.
  - Proves normal owners do not receive the admin-only design payload.
  - Proves configured admins receive design metadata only.
  - Proves no retained export migration, retained export API route, storage call, browser persistence, or retained-export SQL write exists.

- `package.json`
  - Adds `test:community-member-retained-export-approval-design`.

## Production-Mutation Confirmation

DZN_LIVE_CHECKOUT_ENABLED remains disabled.

This slice does not mutate live Stripe products or prices, Cloudflare secrets, production D1, Nitrado, Discord, retained export storage, retained export files, export-history rows, sharing links, or issue #49.

## Next Recommended Slice

Only after a deliberate approval decision: retained-export implementation preflight. That future slice should first open the dedicated retained-export approval issue or PR and pass approval, migration, expiry, storage, security, rollback, and proof review before adding any retained export files, export-history rows, sharing links, storage bindings, or retention write APIs.
