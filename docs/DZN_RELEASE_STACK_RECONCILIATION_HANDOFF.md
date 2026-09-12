# DZN Release Stack Reconciliation Handoff

## Current Handoff: 2026-09-12

PR #123 is refreshed onto the current release. The new current section in
`DZN_RELEASE_STACK_RECONCILIATION_PREFLIGHT.md` supersedes the recommendations in
the historical record below. Player navigation and the first playable Games Hub
are already released; they must not be rebuilt from the old stack.

`DZN_RELEASE_BACKLOG_2026-09-12.md` records the initial 76-request comparison.
The remaining original #50-#122 stack must be assessed feature by feature;
file equality is not a semantic implementation or live activation test.
The backlog keeps Games/XP, moderation/support, maps, exact-server access, ADM,
FED & FERAL, real account linking and customer billing proof visible.

The refresh changes documentation, the existing documentation check and its test
registration only. It adds no runtime, migration, setting, provider dependency or
paid operation. Later authorized main merges use the existing Pages release
path; the old statement below about no merge/deployment describes August 31 only.

## Historical Handoff: 2026-08-31

Date: 2026-08-31

## What This Slice Did

Created a non-mutating release preflight for the current DZN stacked PR state. The goal is to prevent a blind full-stack merge/deploy while still keeping the project moving toward the live site.

## Branch

- Branch: `codex/dzn-release-stack-reconciliation-preflight-20260831`
- Base: `origin/main`
- Base commit: `7f00d2eb6b68bae112eb02d771036c5b97f8e9ea`

## Files

- `docs/DZN_RELEASE_STACK_RECONCILIATION_PREFLIGHT.md`
- `docs/DZN_RELEASE_STACK_RECONCILIATION_HANDOFF.md`
- `scripts/test-dzn-release-stack-reconciliation-preflight.ts`
- `package.json`

## Decision

Do not merge/deploy the latest stacked head directly. The open stack spans PR #50 through #122 and includes draft blockers #63, #64, #65, #100, and #101. The later Comms and Store work should remain disabled/review-gated until each runtime/payment step is deliberately approved.

## Recommended Next Work

The next practical implementation slice should be a main-based personal player navigation/access audit and release candidate, because the user has repeatedly asked where the personal player page button is. Build it from current `origin/main` in a new isolated branch rather than merging the entire Store/Comms stack.

Keep out of scope:

- Store/payment fulfilment
- Supporter Card public reveal
- live checkout
- issue/PR #49
- production D1 migrations
- Cloudflare secret/config mutations
- Nitrado/Discord production mutations
- Comms sending, reactions runtime, reports, moderation writes, WebSockets/Durable Objects, DZN Assist AI, analytics/tracking
- competitive scoring, rankings, eligibility, XP awards, calling-card awards

## Validation Needed For This Slice

- `npm run test:dzn-release-stack-reconciliation-preflight`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint -- --ignore-pattern .wrangler/**`
- `npm run build`
- `npm test`
- `git diff --check`

No production deployment or live-site mutation is included in this slice.
