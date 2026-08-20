# DZN Billing Phase 1 Handoff

## Status

Last updated: 2026-08-20

Billing Phase 1 has completed two committed micro-slices on `feature/event-platform-performance-foundation`:

1. `8db588f8562270ff2eb9a99c94442e9ff68ca639` - linked-server allowance reservation lifecycle.
2. `75d76f325521d33854974f1f71a07a4fe509bac6` - reservation-aware allowance reporting.

Phase 0 recovery then corrected repository blockers from an isolated clean worktree. Event Suggestions remains migration `0057_event_suggestions_phase_2a.sql`; Billing Integrity is now migration `0058_billing_phase_1_integrity.sql`.

## Completed Billing Work

- Additive reservation schema for linked-server allowance holds.
- Runtime reservation schema helpers in `functions/_lib/onboarding.ts`.
- Reservation acquisition during draft linked-server creation.
- Reservation completion on service attachment.
- Reservation release on known onboarding, service-attachment, and pending-token failure paths.
- Expiration handling for stale active reservations.
- Reservation-aware `countLinkedServersForUser`.
- Reservation-aware `getLinkedServerAllowanceUsageForUser`.
- Billing status reporting aligned with committed linked servers plus active unexpired reservations.
- Dashboard compatibility preserved through the existing `/api/billing/status` public response shape.

## Phase 0 Recovery Notes

- Duplicate migration numbering was resolved by moving Billing Integrity to `migrations/0058_billing_phase_1_integrity.sql`.
- Migration regression coverage now checks unique four-digit prefixes, deterministic ordering, Event Suggestions at 0057, Billing Integrity at 0058, fresh local application, upgrade application from the pre-billing state, and stale filename references.
- `functions/api/onboarding/test.ts` now maps setup ADM backfill progress from the real `AdmImportJobProgressResult` shape.
- The setup response keeps legacy external names `id` and `adm_file` where the setup wizard consumes them, mapping from `job_id` and `filename`.
- Legacy line range fields are returned as `null` because the current job type does not expose honest `line_start` or `line_end` semantics.
- Completed and completed-with-warnings jobs are handled without claiming active or queued jobs as processed.
- `package.json` exposes `npm run test:billing-integrity`.
- Phase 0 used isolated clean worktree `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-phase0-clean-20260820-155027`.
- The interrupted broader worktree remains preserved and uncommitted on `feature/billing-phase-1-integrity`.

## Validation Expectations

The Phase 0 recovery validation must include:

- `npm run test:billing-integrity`
- `npm run test:billing-plans`
- `npm run test:dashboard-loading`
- `npm run test:dashboard-core-first-load`
- `npm run test:owner-console`
- `npm run test:github-workflows`
- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npm run build`
- `git diff --check`

No preview workflow, deployment, remote migration, production D1 access, production D1 write, D1 bookmark, secret change, Stripe change, Discord flag change, or Discord send occurred during Phase 0 recovery.

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

- No Stripe webhook, checkout, subscription-transition, Discord OAuth, deployment, production service, or live database paths were changed.
- No Nitrado token selection, exact-token association, encrypted-token storage, or token decryption behavior was changed in Phase 0.
- No reservation IDs, tokens, release reasons, failure internals, secrets, or unnecessary billing internals are exposed to clients.
- No destructive migration or data reset was added.
- No `player_stats` table was created; `player_profiles` was not changed.
- 401/403 endpoint protection was not weakened.
- Cloudflare/GitHub workflow secret handling was not changed.
- Same-category matchmaking was not changed.

## Remaining Risks

- `functions/_lib/plans.ts` imports the reservation-aware usage helper from `functions/_lib/onboarding.ts`; tests pass, but a future cleanup could extract allowance usage into a dedicated shared billing module to reduce coupling.
- Existing duplicate-service behavior in `saveLinkedServerNitradoService` still contains the pre-existing draft cleanup path; Phase 0 did not change it.
- The preserved interrupted branch contains broader integrity ideas that must be audited selectively against the clean post-Phase-0 branch rather than applied wholesale.

## Next Incomplete Slice

Audit and selectively reimplement the preserved exact linked-server Nitrado token association, cross-owner service ownership conflict protection, same-owner idempotent canonical server reuse and deterministic onboarding integrity work against the clean post-Phase-0 branch. Do not apply the preserved dirty patch wholesale.
