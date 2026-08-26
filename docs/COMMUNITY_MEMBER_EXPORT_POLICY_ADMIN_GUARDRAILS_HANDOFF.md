# Community Member Export Policy Review and Admin Guardrails Handoff

Branch: `codex/community-member-export-policy-admin-guardrails-20260826`
Base: `codex/community-member-export-policy-retention-settings-20260826` at `5320a093c3cd83b434164dfc5cefc97385c7d274`

This slice adds an admin-only policy review affordance for community member audit exports. It confirms the current private, bounded, download-only, non-persistent export defaults across all owner scopes and flags any future retained-export work as blocked until a dedicated approval, migration, expiry model, storage plan, and security review exist.

## Implementation

- `functions/_lib/community-member-source-management.ts`
  - Adds `CommunityMemberSourceExportPolicyReview`.
  - Adds `communityMemberSourceExportPolicyReview`.
  - Adds `export_policy_review` to `listCommunityMemberSourceManagement`.
  - Returns `export_policy_review` only for `actor.role === "admin"`; normal owners receive `null`.
  - Adds safeguards for admin-only policy review, all owner-scope export default confirmation, and blocked future retained-export work.
- `components/community/community-member-source-dashboard.tsx`
  - Adds the admin-only policy review UI when the server payload role is `admin`.
  - Shows `Admin only`, `All owner scopes`, and `Current defaults confirmed`.
  - Shows `Future retained-export work blocked` with these gates:
    - Dedicated approval required.
    - Migration required.
    - Expiry model required.
    - Storage plan required.
    - Security review required.
- `scripts/test-community-member-source-management-audit.ts`
  - Adds static and runtime coverage for admin-only review visibility, owner denial, export defaults, blocked future retention gates, no storage side effects, and isolation from public profile visibility and competitive systems.
- `docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md`
  - Adds the `Community Member Export Policy Review and Admin Guardrails Slice`.
  - Updates the access matrix for the admin-only review payload and retained-export block.
- `docs/PUBLIC_ACCESS_POLICY.md`
  - Documents the admin-only policy review and confirms future retained-export work remains blocked.

## Access Boundary

- Logged-out visitors cannot access these surfaces.
- Free logged-in players cannot access these owner/admin community member export controls.
- Normal owners must pass the canonical owner entitlement boundary and can manage or export only their own linked-server scope.
- Configured DZN admins can review the global source queue and receive the admin-only `export_policy_review` payload.
- Normal owners do not receive `export_policy_review`.

## Current Defaults Confirmed

- Current retention: `download_only`.
- Persisted exports: `false`.
- Export file retention: `not_persisted_by_dzn`.
- Dashboard history: `client_session_only`.
- Sharing links: `false`.
- Browser persistence: `false`.

## Retained Export Block

Future retained-export work is blocked until a separate approved slice provides:

- Dedicated approval required.
- Migration required.
- Expiry model required.
- Storage plan required.
- Security review required.

This slice does not add a persistent export-retention model, stored export files, export-history tables, browser persistence, sharing links, retention setting write APIs, or retention setting save buttons.

## Isolation

The admin-only policy review is a governance and presentation aid only. It cannot make a player publicly visible without the player's opt-in generated handle and must not affect CTF scoring rows, owner workflow decisions, approval decisions, bracket outcomes, billing, rankings, discovery score, reviews, badges, seasons, Server Wars scoring, XP awards, calling-card awards, or competitive eligibility.

No production D1 migration was applied. DZN_LIVE_CHECKOUT_ENABLED remains disabled. This slice does not mutate Stripe products or prices, Cloudflare secrets, Nitrado, Discord resources, production D1, or issue #49.

## Validation

Completed validation:

- `npm run test:community-member-export-policy-admin-guardrails` passed.
- `npx tsc --noEmit --incremental false` passed.
- `npm run lint` passed with existing warnings only in unrelated files.
- `npm run build` passed.
- `npm run check:billing-config` passed as a read-only check and confirmed live checkout remains disabled.
- `npm test` passed.
- `git diff --check` passed.
- Added-line mutation scans found no new live checkout, Stripe product/price, Cloudflare secret, production D1, Nitrado, Discord, migration, retained-export table/write, or browser-storage export-retention path.
- Codex Security diff scan `41f1613d-c358-4d5a-ab65-fd501a2c1364` completed with zero findings and complete coverage for the changed code/test/docs surfaces.

Known validation note: the local TAC advisory could not verify Trusted Access for Cyber because the Codex Security Access connector was not connected.

## Next Recommended Slice

Next should be retained-export approval design only if deliberately approved: define the approval owner, exact migration shape, expiry model, storage plan, security review checklist, and rollback rules before any retained export files, export-history rows, sharing links, or retention write APIs are implemented.
