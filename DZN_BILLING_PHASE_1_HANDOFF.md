# DZN Billing Phase 1 Handoff

## Completed Micro-Slice

Linked-server allowance reservation lifecycle across Nitrado validation, onboarding save, and service attachment.

## Implementation

- Added additive reservation schema in `migrations/0057_billing_phase_1_integrity.sql`.
- Added matching runtime schema helpers in `functions/_lib/onboarding.ts`:
  - `linked_server_allowance_reservations` table creation.
  - Active reservation expiry.
  - Reservation acquisition with plan-aware allowance checks.
  - Idempotent completion and release.
  - Reservation-aware linked-server counting.
- Updated Nitrado validation draft creation to reserve an allowance before creating/updating the pending draft and release on draft write failure.
- Updated direct service attachment to complete the reservation after the linked-server service write succeeds, or release it on attachment failure / duplicate existing-service attachment.
- Updated token storage failure handling to release the linked draft reservation when the Nitrado token write fails.
- Updated onboarding save to reserve before new linked-server writes, complete after all required onboarding writes succeed, and release on failed/aborted write paths.
- Added a narrow Nitrado validation 402 response for `LinkedServerAllowanceExceededError`.
- Added `scripts/test-billing-integrity.ts` with in-memory SQLite/D1 coverage for active, expired, completed, released, duplicate/idempotent, plan-limit, validation, service attachment, and failed save paths.

## Validation

- `npx tsx scripts/test-billing-integrity.ts`: passed.
- `npm run test:billing-plans`: passed.
- `npm run lint`: passed with 12 existing warnings, 0 errors.
- `npm run build`: passed.
- `git diff --check`: passed.
- `npx tsc --noEmit --pretty false`: failed only on pre-existing `functions/api/onboarding/test.ts` `AdmImportJobProgressResult` property errors (`adm_file`, `id`, `line_start`, `line_end`).

## Verified Behaviors

- Runtime helper SQL and additive migration SQL agree.
- Active unexpired reservations count toward allowance.
- Expired, completed, and released reservations do not count.
- Active reservations attached to already-committed linked-server rows do not double-count.
- Reservation completion happens after the linked-server write succeeds.
- Failed draft, token, service-attachment, and onboarding-save paths release the active reservation.
- Expiry, completion, and release are idempotent.
- Free, Starter, Pro, Premium, legacy Network, legacy Partner, and inactive paid statuses preserve expected allowance behavior.
- The reservation lifecycle does not delete or reset existing player/profile/event/session/subscription data and does not touch production services, credentials, deployments, or live databases.

## Remaining Risks

- `getOwnerBillingStatus` still uses its existing direct linked-server count and was not moved to the reservation-aware helper in this slice.
- Existing duplicate-service behavior in `saveLinkedServerNitradoService` still contains the pre-existing draft cleanup path; this slice only wrapped reservation finalization around it.
- The explicit `tsc --noEmit` failure remains outside this slice in `functions/api/onboarding/test.ts`.

## Next Incomplete Micro-Slice

Align billing status/dashboard allowance reporting with the reservation-aware count helper, without broad refactors to auth, Stripe webhook processing, Nitrado token handling, or linked-server ownership semantics.
