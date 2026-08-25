# Progression Award Audit UI Handoff

Branch: `codex/progression-award-audit-ui-20260825`
Base: `codex/verified-activity-adapters-audit-20260825` at `042a21aabd2ea848f8eb6e29efbe63a64a24f88c`

This slice surfaces trusted progression award-source history in owner/admin dashboards. It does not change player challenge access, award rules, live checkout, billing plans, Stripe configuration, Nitrado, Discord, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, or competitive eligibility.

## Added

- `components/progression/progression-award-audit-dashboard.tsx`
  - Adds a private owner/admin audit UI for verified progression source facts.
  - Shows counts for total, awarded, progressed, skipped, failed, and retry-available rows.
  - Adds status, adapter, linked-server, and retry-state filters.
  - Shows adapter key, source table/type, player display name, challenge title, linked server, progress value, attempt count, retry count, verified timestamp, and processed timestamp.
  - Shows retry as protected metadata only. It does not call the award cron route and does not render a retry execution button.

- `app/dashboard/progression-awards/page.tsx`
  - Adds the dedicated owner dashboard audit route.

- `app/owner/progression-awards/page.tsx`
  - Adds a matching owner-console route for configured admin/owner review.

- `components/onboarding/dashboard.tsx`
  - Adds a `Progression Audit` tab to the server owner dashboard.
  - Embeds the audit UI with the selected linked server preselected.
  - Keeps the tab behind the existing dashboard session and the audit API's canonical owner entitlement/admin checks.

- `components/owner/owner-console.tsx`
  - Adds a `Progression Audit` owner-console section linking to the dedicated audit page.

- `functions/_lib/player-progression-awards-audit.ts`
  - Extends the existing read-only audit helper with bounded query filters:
    - `status`
    - `adapter_key`
    - `linked_server_id`
    - `retry`
  - Keeps normal owners scoped to their own linked servers.
  - Keeps configured DZN admins able to inspect global source facts.

- `functions/api/owner/progression/award-audit.ts`
  - Wires the new query filters into `GET /api/owner/progression/award-audit`.
  - Keeps all mutation methods rejected.
  - Keeps private no-store responses.

- `scripts/test-progression-award-audit-ui.ts`
  - Locks the UI, API filter, owner/admin access, read-only retry, billing, and competitive-isolation contracts.

## Access Contract

- Normal logged-in players can still use free player surfaces and challenges, but cannot open owner audit data unless they become an entitled owner or configured DZN admin.
- Normal owners must pass the canonical owner entitlement layer before reading audit history.
- Owners can read only verified award-source facts tied to their own linked servers.
- Configured DZN admins can read global award-source history.
- `GET /api/owner/progression/award-audit` is the only dashboard data source for this UI.
- The browser UI must not call `POST /api/cron/player-progression/awards`, must not send `retry_failed`, and must not write award-source rows.

## Filter Contract

- `status=finished|pending|progressed|awarded|duplicate|skipped|failed|all`
- `adapter_key=<trusted adapter key>`
- `linked_server_id=<accessible linked server id>`
- `retry=available|not_available|all`

All filter values are read-only query parameters. Linked-server filtering is additive to the canonical owner/admin scope, so it cannot reveal another owner's rows.

## Retry Contract

Retries remain cron-secret-only. The UI may display failed-row counts, `retry_available`, attempt counts, retry counts, and retry timestamps. It must not provide a browser button that invokes the award job, must not accept session auth as a retry substitute, and must not use owner entitlement, Starter, Pro, Nitrado, Stripe, or Discord permissions to execute retries.

## Fairness

Progression award-source history is operational audit metadata only. It must not affect:

- live payments
- paid plan status
- rankings or leaderboard formulas
- discovery score
- reviews or review score
- badges
- seasons
- events or tournaments
- Server Wars scoring/results
- server ownership
- competitive eligibility

Paid owner plans can grant owner tool access to audit visibility. They cannot grant XP, grant calling cards, improve award odds, retry player awards from the browser, or change any competitive result.

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

- `npm run test:progression-award-audit-ui`
- `npm run test:progression-award-source-adapters-audit`
- `npm run test:progression-awards-foundation`
- `npm run test:challenges-xp-calling-cards-foundation`
- `npm run test:player-hub-foundation`
- `npm run test:player-saved-servers`
- `npm run test:reviews-foundation`
- `npm run test:reviews-moderation-dashboard`
- `npm run test:reviews-moderation-workflow-polish`
- `npm run test:review-notification-read-state`
- `npm run test:public-access-gating`
- `npm run test:nav-access-visibility`
- `npm run test:player-owner-access-foundation`
- `npm run test:public-leaderboards`
- `npm run test:reputation-platform`
- `npm run test:badge-awards`
- `npm run test:badge-evaluation`
- `npm run test:dzn-seasons`
- `npm run test:events`
- `npm run test:server-war-scoring`
- `npm run test:server-war-gating`
- `npm run test:server-wars`
- `npm run test:server-war-automation`
- `npm run test:billing-plans`
- `npm run test:stripe-live-readiness`
- `npm run test:stripe-live-activation-checklist`
- `npm run check:billing-config`
- `npx tsc --noEmit --incremental false`
- `npm run lint`
- `npm run build`
- `git diff --check`

## Next Slice

Next should be the player profile progression showcase slice: make earned XP, challenge progress, and calling cards more visible from the player profile/Player Hub, with privacy-aware display controls and tests proving profile progression remains earned/player-side only and separate from paid plans, rankings, discovery, reviews, badges, seasons, events, Server Wars scoring, and competitive eligibility.
