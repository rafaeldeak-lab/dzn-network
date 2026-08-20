# DZN Billing Phase 1 Handoff

## Status

Last updated: 2026-08-20

Billing Phase 1 has completed three committed micro-slices on `feature/event-platform-performance-foundation`:

1. `8db588f8562270ff2eb9a99c94442e9ff68ca639` - linked-server allowance reservation lifecycle.
2. `75d76f325521d33854974f1f71a07a4fe509bac6` - reservation-aware allowance reporting.
3. `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02` - linked-server Nitrado credential integrity.

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
- Exact Nitrado credential lookup for linked servers by authenticated `user_id` and exact `linked_server_id`.
- Server-scoped Nitrado service discovery, onboarding save, setup verification, and ADM path testing now avoid user-global latest-token selection.
- Cross-owner Nitrado service conflicts return safe 409 responses with `nitrado_service_already_linked`.
- Same-owner duplicate service linking reuses the canonical linked-server row.
- Temporary same-owner blank drafts are retired as `merged` and point at the canonical linked server instead of being deleted.
- Pending Nitrado credentials move only between linked servers owned by the same user.
- Linked-server allowance reservations complete or release deterministically across first-time attachment, same-owner canonical reuse, cross-owner conflicts, and save failure.
- New-server Discord announcement scheduling is gated by `createdNewCanonicalServer`, with the compatibility `createdNewLinkedServer` local guard preserved for the existing static announcement test.
- The setup wizard retains `validatedLinkedServerId` through direct validation and browse-services flows, and clears stale linked-server state when validation context changes.

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

## Linked-Server Nitrado Integrity Slice

Verified implementation facts:

- `functions/_lib/onboarding.ts` now exposes `assertLinkedServerOwnedByUser`, `getNitradoTokenForLinkedServer`, and same-owner credential reassociation helpers.
- Exact token resolution first proves linked-server ownership, then selects from `nitrado_connections` using both `user_id` and `linked_server_id`.
- Missing exact credentials return no token and do not fall back to another linked server's token.
- Foreign linked-server IDs fail ownership checks before token selection or decryption.
- `functions/api/nitrado/services.ts`, `functions/api/nitrado/test-adm-path.ts`, `functions/api/onboarding/test.ts`, and `functions/api/onboarding/save.ts` were converted away from `getLatestNitradoToken`.
- `functions/api/onboarding/save.ts` no longer calls `linkLatestNitradoConnection`.
- Existing foreign linked-server ownership cannot be changed; linked-server updates are constrained by canonical id and owner id.
- No update assigns a new `user_id` to an existing canonical linked server.
- Same-owner canonical reuse moves source credentials to the canonical row, merges blank temporary drafts, and releases the source reservation.
- Cross-owner service conflicts release the source reservation and return the stable `nitrado_service_already_linked` code without exposing foreign owner data.
- Repeated same-owner saves converge on one canonical linked-server ID and do not schedule another announcement.
- Direct and browse onboarding flows pass the validated linked-server ID into service discovery and save.
- No token, encrypted token, IV, auth tag, or encryption key value is returned in API responses or logged by this slice.

## Latest Validation

Post-slice validation from the canonical clean worktree:

- `npm test`: exit 0. Full log: `C:\Users\rafae\Desktop\DZN-Audits\logs\phase1-linked-server-integrity-20260820-165614\npm-test.log`.
- Optional owner-supplied raw ADM fixture self-skipped for the known missing local bundle reason.
- `npm run test:billing-integrity`: exit 0.
- `npm run test:billing-plans`: exit 0.
- `npm run test:nitrado-diagnostics`: exit 0.
- `npm run test:dashboard-loading`: exit 0.
- `npm run test:dashboard-core-first-load`: exit 0.
- `npm run test:owner-console`: exit 0.
- `npm run test:public-access-gating`: exit 0.
- `npm run test:auth-return-flow`: exit 0.
- `npm run test:server-metadata`: exit 0.
- `npm run test:github-workflows`: exit 0.
- `npx tsc --noEmit --pretty false`: exit 0.
- `npm run lint`: exit 0, with 0 errors and the same 4 warnings.
- `npm run build`: exit 0.
- `git diff --check`: exit 0.

No preview workflow, deployment, remote migration, production D1 access, production D1 write, D1 bookmark, secret change, Stripe change, Discord flag change, or Discord send occurred during Phase 0 recovery.

No preview workflow, deployment, remote migration, production D1 access, production D1 write, D1 bookmark, secret/env change, Stripe change, Discord flag change, Discord send, ADM trigger, Nitrado trigger, scheduler trigger, or advertising trigger occurred during this linked-server integrity slice.

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
- Exact-token isolation tests prove one server cannot borrow another linked server's newer token.
- Cross-owner conflict tests prove existing foreign ownership is not transferred and credentials are not reassociated to the foreign canonical server.
- Same-owner idempotency tests prove canonical reuse does not consume another allowance slot.
- Authorization tests prove service discovery still returns 401 without a session and 404 for foreign linked-server IDs.

## Security And Compatibility Review

- No Stripe webhook, checkout, subscription-transition, Discord OAuth, deployment, production service, or live database paths were changed.
- Phase 0 did not change Nitrado token selection, exact-token association, encrypted-token storage, or token decryption behavior.
- The linked-server integrity slice changed Nitrado token selection only for targeted server-scoped routes, replacing user-global latest-token fallback with exact linked-server credential lookup.
- No reservation IDs, tokens, release reasons, failure internals, secrets, or unnecessary billing internals are exposed to clients.
- No destructive migration or data reset was added.
- No `player_stats` table was created; `player_profiles` was not changed.
- 401/403 endpoint protection was not weakened.
- Cloudflare/GitHub workflow secret handling was not changed.
- Same-category matchmaking was not changed.
- Security searches confirmed targeted server-scoped routes do not call `getLatestNitradoToken` or `linkLatestNitradoConnection`.
- Security searches confirmed no `DELETE FROM linked_servers` remains in `functions/_lib/onboarding.ts` or `functions/api/onboarding/save.ts`.
- Legacy global Nitrado helper definitions remain for existing non-slice code paths only.

## Remaining Risks

- `functions/_lib/plans.ts` imports the reservation-aware usage helper from `functions/_lib/onboarding.ts`; tests pass, but a future cleanup could extract allowance usage into a dedicated shared billing module to reduce coupling.
- Production runtime health, Cloudflare Pages aliases, runtime secrets, and D1 state remain unverified in this slice.
- Legacy global Nitrado helper definitions still exist for older code paths outside the targeted server-scoped routes; changing those broader paths should be a separately scoped review.
- Preview verification for migrations 0057 and 0058 has not been run and is the next authorized slice below.

## Next Authorised Slice

Build and run a guarded Billing Phase 1 isolated preview covering migrations 0057 and 0058, exact linked-server Nitrado credential association, cross-owner conflict protection, same-owner canonical reuse, allowance integrity and onboarding verification. No production deployment or production migration.
