# DZN Billing Phase 1 Handoff

## Completed Micro-Slices

1. Linked-server allowance reservation lifecycle across Nitrado validation, onboarding save, and service attachment.
2. Billing status and dashboard allowance reporting aligned with reservation-aware enforcement.

## Latest Implementation

Reporting alignment and handoff recording changed exactly these files:

- `functions/_lib/onboarding.ts`
  - Added `getLinkedServerAllowanceUsageForUser`.
  - Centralized allowance usage, remaining-capacity clamp, and `canLinkMore` calculation around the existing reservation-aware linked-server count.
  - Updated reservation acquisition to use the same usage helper used by reporting.
- `functions/_lib/plans.ts`
  - Replaced the old direct `linked_servers` count in `getOwnerBillingStatus`.
  - Billing status now reports `linked_server_count` and `can_link_more_servers` from the reservation-aware usage helper while preserving the existing response shape.
- `scripts/test-billing-integrity.ts`
  - Added regression coverage for billing status/API reporting with committed linked servers, active unexpired reservations, expired reservations, released reservations, completed reservations plus linked-server rows, fully consumed allowance, remaining-capacity clamping, current plans, legacy Network/Partner normalization, free/trial/inactive states, and response compatibility.
- `DZN_BILLING_PHASE_1_HANDOFF.md`
  - Recorded the reporting slice, validation results, compatibility review, remaining risks, and next incomplete slice.

No dashboard component change was required: the dashboard already renders `linked_server_count / entitlements.max_linked_servers` from `/api/billing/status`, and that API now uses the reservation-aware source of truth.

## Preserved Reservation Lifecycle Slice

- Additive reservation schema remains in `migrations/0057_billing_phase_1_integrity.sql`.
- Runtime reservation schema helpers remain in `functions/_lib/onboarding.ts`.
- Nitrado validation, onboarding save, direct service attachment, and pending token failure paths still acquire, complete, or release reservations.
- The validated reservation-lifecycle slice was committed as `feat(billing): add linked server reservation lifecycle`.

## Validation Results

- `git diff --check`: passed before the reservation-lifecycle commit and passed after the reporting slice.
- `npx tsx scripts/test-billing-integrity.ts`: passed before the reservation-lifecycle commit and passed after the reporting slice.
- `npm run test:billing-plans`: passed.
- `npm run test:dashboard-loading`: passed.
- `npm run test:dashboard-core-first-load`: passed.
- `npm run test:owner-console`: passed.
- `npm run lint`: passed with 12 existing warnings, 0 errors.
- `npm run build`: passed.
- `npx tsc --noEmit --pretty false`: failed only on the pre-existing `functions/api/onboarding/test.ts` `AdmImportJobProgressResult` property errors for `adm_file`, `id`, `line_start`, and `line_end`.

## Verified Behaviors

- Runtime helper SQL and additive migration SQL agree.
- Active unexpired reservations count toward enforcement and billing status reporting.
- Expired, released, and failed-path released reservations do not consume allowance.
- Completed reservations do not double-count beside their linked-server row.
- Billing status expires stale active reservations before reporting usage.
- Remaining capacity is clamped to zero internally when usage exceeds the allowance.
- Free, Starter, Pro, Premium, legacy Network, legacy Partner, trialing, free, and inactive paid states preserve expected allowance behavior.
- `/api/billing/status` keeps its existing top-level response shape.
- Dashboard billing cards continue to use the same public status fields.
- Owner-console linked-server counts remain read-only operational inventory, not billing allowance usage.

## Security And Compatibility Review

- No Stripe webhook, checkout, subscription-transition, Discord OAuth, Nitrado credential, deployment, production service, or live database paths were changed.
- No reservation IDs, tokens, release reasons, failure internals, secrets, or unnecessary billing internals are exposed to clients.
- No destructive migration or data reset was added.
- No `player_stats` table was created; `player_profiles` was not changed.
- 401/403 endpoint protection was not weakened.
- Cloudflare/GitHub workflow secret handling was not changed.
- Same-category matchmaking was not changed.

## Remaining Risks

- `functions/_lib/plans.ts` now imports the reservation-aware usage helper from `functions/_lib/onboarding.ts`; tests pass, but a future cleanup could extract allowance usage into a dedicated shared billing module to reduce coupling.
- Existing duplicate-service behavior in `saveLinkedServerNitradoService` still contains the pre-existing draft cleanup path; this work only preserves reservation finalization around it.
- Full `npx tsc --noEmit --pretty false` remains blocked by the pre-existing `functions/api/onboarding/test.ts` `AdmImportJobProgressResult` type drift.

## Next Incomplete Micro-Slice

Resolve the pre-existing `functions/api/onboarding/test.ts` `AdmImportJobProgressResult` type drift so the repository-wide TypeScript check can pass, without changing reservation enforcement semantics, billing status response shape, Stripe flows, Discord OAuth, Nitrado token handling, production services, or live databases.
