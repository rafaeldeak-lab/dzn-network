# DZN Billing Phase 1 Handoff

## Status

Last updated: 2026-08-21

Billing Phase 1 has completed three committed micro-slices on `feature/event-platform-performance-foundation`:

1. `8db588f8562270ff2eb9a99c94442e9ff68ca639` - linked-server allowance reservation lifecycle.
2. `75d76f325521d33854974f1f71a07a4fe509bac6` - reservation-aware allowance reporting.
3. `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02` - linked-server Nitrado credential integrity.

Phase 0 recovery then corrected repository blockers from an isolated clean worktree. Event Suggestions remains migration `0057_event_suggestions_phase_2a.sql`; Billing Integrity is now migration `0058_billing_phase_1_integrity.sql`.

The owner confirmed the Cloudflare account is already on Workers Paid. The stale preview D1 capacity guard that still used the Workers Free account limit was corrected from `10` to `50000` in `5615bbaafeb5016948ed25f5968afd6d70000218` (`fix(preview): use Workers Paid D1 capacity limit`). No Cloudflare plan audit, plan change, D1 deletion, cleanup, Stripe change, production deployment, or production migration was performed.

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
- The paid-plan Billing preview rerun created the candidate-specific preview D1 and applied migrations through `0058`, then failed during Billing schema verification because `linked_servers.merged_into_server_id` was missing. The preview remains incomplete.

## Isolated Billing Preview Dispatch Evidence

Slice 4B result: BLOCKED.

Candidate and workflow state:

- Candidate commit: `17b9535a695188218c10213d55265570cce15275` (`test(ci): keep workflow boundary checks typecheckable`).
- Active remote branch before evidence documentation: `origin/feature/event-platform-performance-foundation` at `17b9535a695188218c10213d55265570cce15275`.
- Billing preview workflow implementation commits verified as ancestors of the active remote branch:
  - `6ca3afa2e081094285892e0b279e6abf4badd442` - `ci(preview): add billing preview mode guards`.
  - `3d46b4f4908a062f3f622f3e792bf49773024323` - `ci(preview): add isolated billing preview runtime`.
  - `67fa715886e36bda0102b70f26da764bc071c6ed` - `test(billing): make token corruption check date-stable`.
  - `17b9535a695188218c10213d55265570cce15275` - `test(ci): keep workflow boundary checks typecheckable`.
- Dispatch mode: `billing-phase-1-preview`.
- Dispatch ref: `feature/event-platform-performance-foundation`.
- Required confirmations used: `confirm_preview_only=PREVIEW_ONLY`, `confirm_billing_phase_1_preview=APPROVE_BILLING_PHASE_1_PREVIEW`.
- Secure dispatch method: Git Credential Manager credential captured only in memory for a PowerShell REST dispatch. `gh` was not installed, and no `GH_TOKEN` or `GITHUB_TOKEN` environment credential was present. No token was printed or saved.

Workflow run evidence:

- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32457796161`.
- Run ID: `32457796161`.
- Run number: `56`.
- Run attempt: `1`.
- Event: `workflow_dispatch`.
- Branch: `feature/event-platform-performance-foundation`.
- Head SHA: `17b9535a695188218c10213d55265570cce15275`.
- Created: `2026-08-21T07:14:57Z`.
- Updated: `2026-08-21T07:15:42Z`.
- Final conclusion: `failure`, classified as BLOCKED because the workflow stopped at a safe Cloudflare D1 capacity precondition before preview setup could mutate resources.
- Failed step: `Resolve or create preview D1 database`.
- Blocker: Cloudflare D1 database count was `10`, configured limit was `10`, and requested preview D1 `dzn_network_db_owner_console_preview_billing_phase_1_17b9535` did not exist.
- Billing steps skipped after the blocker: `Apply preview D1 migrations`, `Verify Billing Phase 1 preview schema`, `Seed Billing Phase 1 preview fixtures`, `Resolve or create preview Pages project`, `Configure preview owner auth secrets`, `Configure Billing Phase 1 preview runtime`, `Build Billing Phase 1 preview runtime`, `Deploy Billing Phase 1 preview runtime`, `Verify Billing Phase 1 preview`.
- Artifact upload step completed successfully.
- Total dispatch attempts: one. No rerun or remediation dispatch was attempted.

Isolated resource evidence:

- Dedicated preview Pages project configured by the committed workflow: `dzn-network-owner-console-preview-billing-phase-1`.
- Stable preview URL configured by the committed workflow: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Immutable preview URL: not produced because the run stopped before Pages deployment.
- Candidate-specific preview D1 name: `dzn_network_db_owner_console_preview_billing_phase_1_17b9535`.
- Preview D1 creation/reuse status: not created or reused; requested D1 did not exist and the account was already at the configured D1 limit.
- Masked preview D1 ID: unavailable because no preview D1 was resolved.
- Masked production D1 ID observed only for safety comparison: `37515c66...975e`.
- Production-name mismatch confirmed: preview project does not equal `dzn-network`; preview D1 name does not equal `dzn_network_db`.
- Production-ID mismatch could not be completed for the preview D1 because no preview D1 ID was available.
- No D1 database was deleted, no cleanup workflow ran, and no preview cleanup was invoked.

Artifact and evidence:

- Artifact name: `dzn-billing-phase-1-preview`.
- Artifact ID: `9437848736`.
- Artifact extraction path: `C:\Users\rafae\Desktop\DZN-Audits\preview-runs\billing-phase-1-17b9535-32457796161\dzn-billing-phase-1-preview`.
- Log archive path: `C:\Users\rafae\Desktop\DZN-Audits\preview-runs\billing-phase-1-17b9535-32457796161\github-run-logs.zip`.
- Sanitized artifact files reviewed: `candidate.json`, `summary.md`.
- Artifact secret scan result: clean; no Cloudflare API token, GitHub token, `TOKEN_ENCRYPTION_KEY` value, `SESSION_SECRET` value, session token, session hash, cookie, raw Nitrado token, encrypted token, token IV, token auth tag, Authorization header, complete D1 UUID, or foreign owner identity was found.

Migration, schema, and Billing matrix status:

- Migration/schema verification did not run because the D1 capacity blocker occurred before migration application.
- Migration ledger, migrations through `0058`, reservation schema, linked-server merge fields, Nitrado linked-server field, active service uniqueness, and `PRAGMA foreign_key_check` remain unverified in this preview run.
- Logged-out protection, service discovery, exact-token isolation, corrupted-token handling, cross-owner conflict, same-owner reuse, draft merge, credential reassociation, first-time claim, repeated-save idempotency, allowance usage, reservation completion/release, announcement gating, onboarding test, and ADM-path test did not run in this preview run.
- Runtime health checks, stable-versus-immutable comparison, worker route presence, HTTP 500/503 checks, Error 1102 checks, and React runtime marker checks did not run because no Pages deployment occurred.

Security and production-safety evidence:

- Preflight and artifact evidence confirmed `MOCK_AUTH=true`, `MOCK_NITRADO=true`, `DZN_DISCORD_NOTIFICATIONS_ENABLED=false`, and `DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false`.
- No real Nitrado call occurred.
- No Discord send occurred.
- No Stripe path was changed or invoked.
- No production deployment, production migration, production D1 SQL read/write, production Pages mutation, production Worker mutation, production secret change, D1 deletion, preview cleanup, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, or force-push occurred.
- Recent manual workflow-dispatch inspection after the run showed only this `DZN Owner Console Preview` dispatch at candidate `17b9535a695188218c10213d55265570cce15275`; no production Pages runtime workflow, production migration workflow, cleanup mode, advertising rollout, Discord production rollout, ADM production trigger, scheduler trigger, or cleanup dispatch was started by this slice.
- The canonical worktree was clean before dispatch. The preserved older worktree and all named backups remained present and were not modified.
- No workflow/script remediation commit was needed because the failure was an external Cloudflare D1 capacity precondition.

## Paid D1 Capacity Guard Correction And Preview Rerun

Slice 4D result: FAILED.

Start state and capacity fix:

- Fresh isolated worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-paid-d1-preview-20260821-192723`.
- Local branch: `fix/paid-d1-capacity-and-preview-20260821-192723`.
- Starting active remote SHA: `81f37431201a4b107648e92f654a968e7eecffea`.
- Required ancestor check passed: `81f37431201a4b107648e92f654a968e7eecffea` was the active remote head and an ancestor of itself.
- Billing preview implementation remained present: `6ca3afa2e081094285892e0b279e6abf4badd442`, `3d46b4f4908a062f3f622f3e792bf49773024323`, and later Billing preview test/fix commits were present in history.
- Owner-confirmed Cloudflare Workers Paid status was treated as source of truth; no Cloudflare plan audit was run.
- Stale guard found in `.github/workflows/dzn-owner-console-preview.yml` as `D1_ACCOUNT_DATABASE_LIMIT: "10"`.
- Capacity fix commit: `5615bbaafeb5016948ed25f5968afd6d70000218` - `fix(preview): use Workers Paid D1 capacity limit`.
- Changed files: `.github/workflows/dzn-owner-console-preview.yml`, `scripts/github-actions/dzn-owner-console-preview/23-resolve-or-create-preview-d1-database.sh`, `scripts/test-github-workflow-boundary.ts`.
- Old limit: `10`.
- New limit: `50000`.
- Resolver now consumes the canonical workflow `D1_ACCOUNT_DATABASE_LIMIT` and no longer falls back to the stale `10` value.
- Retained protections: exact candidate-specific preview D1 reuse only, production D1 name rejection, production D1 ID rejection, capacity stop before creation when actual count is at/above configured limit, no automatic deletion, masked cleanup candidates only, no unrelated preview rebind, and no production fallback.

Local validation before push:

- Shell syntax passed for scripts `01`, `23`, and `32` through `38`.
- `npm run test:github-workflows`: passed.
- `npm run test:billing-integrity`: passed.
- `npm run test:billing-plans`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run lint`: passed with 0 errors and the existing 4 warnings.
- `npm run build`: passed.
- `npm test`: passed. The optional latest ADM raw fixture self-skipped for the known missing owner-supplied bundle reason.
- `git diff --check`: passed.

Commit and push:

- Capacity fix commit pushed as a fast-forward to `origin/feature/event-platform-performance-foundation`.
- Candidate SHA for preview rerun: `5615bbaafeb5016948ed25f5968afd6d70000218`.
- Local HEAD equaled remote active head after push.
- Worktree was clean after push.

Workflow run evidence:

- Dispatched only `.github/workflows/dzn-owner-console-preview.yml`.
- Dispatch mode: `billing-phase-1-preview`.
- Dispatch ref: `feature/event-platform-performance-foundation`.
- Required confirmations used: `confirm_preview_only=PREVIEW_ONLY`, `confirm_billing_phase_1_preview=APPROVE_BILLING_PHASE_1_PREVIEW`.
- Secure dispatch method: Git Credential Manager credential captured only in process memory through Git Bash plus PowerShell REST. `gh` was not installed. No credential was printed or saved.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32513963281`.
- Run ID: `32513963281`.
- Run number: `60`.
- Event: `workflow_dispatch`.
- Branch: `feature/event-platform-performance-foundation`.
- Candidate SHA: `5615bbaafeb5016948ed25f5968afd6d70000218`.
- Created: `2026-08-21T18:33:33Z`.
- Completed: `2026-08-21T18:34:31Z`.
- Final conclusion: `failure`, classified as FAILED because the application Billing schema verification failed after preview D1 creation and migrations.
- Failed step: `Verify Billing Phase 1 preview schema`.
- Failure code: `BILLING_SCHEMA_REQUIRED_COLUMNS_MISSING`.
- Failure detail: `linked_servers` missing required column `merged_into_server_id`.

Isolated resource evidence:

- Dedicated preview Pages project configured by the committed workflow: `dzn-network-owner-console-preview-billing-phase-1`.
- Stable preview URL configured by the committed workflow: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Immutable preview URL: not produced because Pages deployment was skipped after schema verification failed.
- D1 count before creation: `10`.
- Configured D1 limit used by resolver: `50000`.
- Requested preview D1 existed before resolver: `no`.
- Candidate-specific preview D1 name: `dzn_network_db_owner_console_preview_billing_phase_1_5615bba`.
- Masked preview D1 ID: `a9f3c3d7...5b34`.
- Preview D1 creation/reuse result: created for this candidate.
- Production mismatch: preview project did not equal `dzn-network`, preview D1 name did not equal `dzn_network_db`, and preview D1 ID was masked and checked against the detected production ID by the resolver.
- Cleanup candidates were listed only with masked IDs; no cleanup mode was dispatched or triggered.

Migration, schema, and Billing matrix status:

- Billing preview preflight passed.
- Cloudflare preview auth diagnostics passed.
- D1 resolver passed and created the candidate-specific Billing D1.
- Preview D1 migrations applied successfully through `0058_billing_phase_1_integrity.sql`.
- Migration order reached `0057_event_suggestions_phase_2a.sql` then `0058_billing_phase_1_integrity.sql`; both were marked applied.
- Generic owner-console D1 schema verification in the migration step passed.
- Billing Phase 1 schema verification failed on missing `linked_servers.merged_into_server_id`.
- Foreign-key check, reservation table/index checks, exact credential checks, cross-owner 409, same-owner canonical reuse, temporary draft merge, credential reassociation, first-time claim, repeated-save idempotency, allowance counts, reservation completion/release, announcement gating, onboarding test, ADM-path test, runtime route checks, stable-versus-immutable checks, HTTP 503 checks, Error 1102 checks, and Pages Functions worker checks did not run because the schema step failed first.
- Synthetic Billing fixtures were skipped.
- Dedicated Billing preview Pages project creation/configuration was skipped.
- Pages Functions worker build was skipped.
- Isolated Pages preview deployment was skipped.
- Billing endpoint/runtime verification was skipped.

Artifact and evidence:

- Artifact name: `dzn-billing-phase-1-preview`.
- Artifact ID: `9458079667`.
- Evidence extraction path: `C:\Users\rafae\Desktop\DZN-Audits\evidence\billing-paid-d1-preview-32513963281\artifact-9458079667`.
- Log archive path: `C:\Users\rafae\Desktop\DZN-Audits\evidence\billing-paid-d1-preview-32513963281\run-logs.zip`.
- Artifact files reviewed: `candidate.json`, `schema-summary.json`, `summary.md`.
- Artifact security scan found no Cloudflare API token value, GitHub token value, `TOKEN_ENCRYPTION_KEY` value, `SESSION_SECRET` value, session token value, cookie value, raw Nitrado token, encrypted token, token IV, token auth tag, Authorization header, complete D1 UUID, or foreign-owner identity. A descriptive sentence mentions masked owner session tokens but contains no token value.

Security and production-safety evidence:

- Preflight and artifact evidence confirmed `MOCK_AUTH=true`, `MOCK_NITRADO=true`, `DZN_DISCORD_NOTIFICATIONS_ENABLED=false`, and `DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false`.
- No real Nitrado call occurred.
- No Discord message occurred.
- No Stripe path was changed or invoked.
- No D1 deletion occurred.
- No preview cleanup occurred.
- No production D1 access/write occurred.
- No production migration occurred.
- No production deploy occurred.
- No production Pages mutation occurred.
- No production Worker mutation occurred.
- No main change occurred.
- No Event release branch change occurred.
- No PR #15 change occurred.
- No rebase, merge, cherry-pick, reset, stash, clean, or force-push occurred.
- Older dirty worktree `C:\Users\rafae\OneDrive\Desktop\DZN-Network` was not modified; all named backups were retained.

## Read-Only D1 Capacity Audit Evidence

Slice 4C2 result: BLOCKED - GITHUB/CLOUDFLARE READ AUDIT FAILED.

Implementation and validation:

- Audit implementation checkpoint commit: `b7da60b20a75515c96e75f157524bc47fb2c35d4` - `ci(preview): add read-only D1 capacity audit`.
- Audit remediation commit: `4ec2fabfed53587970120c6f37757df3b9c11278` - `fix(preview): use safe Pages project audit listing`.
- Active branch used by the final audit attempt: `feature/event-platform-performance-foundation` at `4ec2fabfed53587970120c6f37757df3b9c11278`.
- Local validation logs are retained outside the repository under `C:\Users\rafae\Desktop\DZN-Audits\logs\d1-capacity-read-only-20260821-161950`.
- Final validation after implementation passed: shell syntax for scripts 01 and 39, `npm run test:github-workflows`, `npm run test:billing-integrity`, `npm run test:billing-plans`, `npx tsc --noEmit --pretty false`, `npm run lint`, `npm run build`, `npm test`, and `git diff --check`.
- Lint remained at 0 errors and the existing 4 warnings. `npm test` retained the documented optional raw ADM fixture skip: raw owner-supplied bundle is not present locally.

Workflow attempts:

- Attempt 1 run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32498388093`.
- Attempt 1 run ID: `32498388093`; run number `57`; attempt `1`; final conclusion `failure`.
- Attempt 1 candidate SHA: `b7da60b20a75515c96e75f157524bc47fb2c35d4`.
- Attempt 1 failure: script 39 used paginated query parameters on the Cloudflare Pages project list endpoint and Cloudflare returned code `8000024` invalid list options. This was an in-scope audit implementation defect.
- Attempt 1 external evidence path: `C:\Users\rafae\Desktop\DZN-Audits\d1-capacity-audits\github-read-only-32498388093`.
- Attempt 2 run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32498659821`.
- Attempt 2 run ID: `32498659821`; run number `58`; attempt `1`; final conclusion `failure`.
- Attempt 2 candidate SHA: `4ec2fabfed53587970120c6f37757df3b9c11278`.
- Attempt 2 created at `2026-08-21T15:38:07Z`; updated at `2026-08-21T15:39:00Z`.
- Attempt 2 failure: script 39 reached the GitHub workflow-log cross-reference and failed while reading a prior job log because the job-log request returned HTTP `415`.
- Attempt 2 external evidence path: `C:\Users\rafae\Desktop\DZN-Audits\d1-capacity-audits\github-read-only-32498659821`.
- Maximum authorised audit dispatch attempts were used: two. No third audit dispatch was attempted.

Observed D1 state from the successful Cloudflare auth diagnostic in attempt 2:

- D1 count observed: `10`.
- `dzn_network_db_owner_console_preview_creator_governance_0919c46` - `f327c5b2...73a5`.
- `dzn_network_db_owner_console_preview_creator_governance_51815be` - `efb4127c...30ff`.
- `dzn_network_db_discord_announcements_preview` - `f7d5eb47...fae6`.
- `dzn_network_db_discord_phase_2a_preview` - `83e3b565...ffb5`.
- `dzn_network_db_discord_control_preview` - `f6c76574...24d0`.
- `dzn_network_db_owner_console_preview` - `8434d3d7...b81b`.
- `dzn_network_db_server_lifecycle_preview` - `692db1da...7ab4`.
- `dzn_network_db_server_advertising_preview` - `1c17f68f...148b`.
- `dzn_network_db_dzn_pulse_preview` - `e27a464f...d73a`.
- `dzn_network_db` - `37515c66...975e`.

Audit result and safety:

- The audit did not complete a retained D1 classification.
- Pages projects checked count and bound/protected resources were not retained because the final run failed before artifact creation.
- No safe cleanup candidate was selected.
- Artifact name requested: `dzn-preview-d1-capacity-audit`.
- Artifact ID: none. The final run had `total_count=0` artifacts because script 39 failed before writing retained artifact files.
- Artifact extraction path: none.
- Artifact security result: no artifact was available to scan; retained external run/job logs were stored outside the repository.
- No deletion occurred.
- No D1 creation occurred.
- No D1 SQL occurred.
- No migration was applied.
- No fixtures were seeded.
- No Pages project was created or modified.
- No Pages binding was changed.
- No Pages secret was written or deleted.
- No Pages deployment occurred.
- No Billing preview rerun occurred.
- No production action occurred.

## Corrected Read-Only D1 Capacity Audit Evidence

Slice 4C3 result: BLOCKED - NO PROVABLY SAFE CANDIDATE.

Implementation and validation:

- Job-log redirect fix commit: `9bcddfba11de8de4c3f185694eeec9d9c48b6700` - `fix(preview): follow GitHub job-log redirects safely`.
- New audit candidate SHA: `9bcddfba11de8de4c3f185694eeec9d9c48b6700`.
- The corrected downloader requests the GitHub job-log API with `Accept: application/vnd.github+json`, uses manual redirect handling, validates the HTTPS redirect target, and downloads the signed log URL separately without Authorization or GitHub API headers.
- Expired or unavailable old signed log URLs are retried once, then recorded as unavailable with safe status and reason fields.
- Unavailable log evidence cannot support `STALE_PREVIEW_CANDIDATE`; incomplete workflow evidence remains fail-closed with `candidate_selected=false`.
- Partial sanitized artifacts are initialized before long inventory/cross-reference operations and are updated progressively.
- Local validation logs are retained outside the repository under `C:\Users\rafae\Desktop\DZN-Audits\logs\d1-job-log-download-20260821-165743`.
- Validation passed: shell syntax for script 39, `npm run test:github-workflows`, `npm run test:billing-integrity`, `npm run test:billing-plans`, `npx tsc --noEmit --pretty false`, `npm run lint`, `npm run build`, `npm test`, and `git diff --check`.
- Lint remained at 0 errors and the existing 4 warnings. `npm test` retained the documented optional raw ADM fixture skip: raw owner-supplied bundle is not present locally.

Workflow run evidence:

- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32500704348`.
- Run ID: `32500704348`; run number `59`; attempt `1`.
- Event: `workflow_dispatch`.
- Branch: `feature/event-platform-performance-foundation`.
- Candidate SHA: `9bcddfba11de8de4c3f185694eeec9d9c48b6700`.
- Created: `2026-08-21T16:00:56Z`.
- Updated/completed: `2026-08-21T16:03:39Z`.
- Final conclusion: `success`.
- Failed steps: none.
- Skipped steps were the non-audit preview, cleanup, rebind, repair, Billing preview, deploy, seed, migration, and production-adjacent preview steps gated off by `mode=audit-preview-d1-capacity`.
- Secure dispatch method: Git Credential Manager credential captured only in process memory through Git Bash. No credential was printed or saved. A PowerShell 204-response handling exception occurred after the dispatch request, but exactly one run for the candidate SHA was created; no duplicate dispatch was made.

Inventory and classification:

- D1 count: `10`.
- Pages projects checked: `8`.
- Pages D1 bindings checked: `16` environment bindings across production and preview configs.
- Workflow cross-reference checked `100` relevant runs and `106` jobs.
- Job logs available: `72`.
- Job logs unavailable: `34`, all recorded as `signed_status_404` after two bounded signed-download attempts.
- No signed URL, Location header, raw log text, credential, Authorization value, or complete D1 ID was retained in the artifact.

Inventoried databases:

- `dzn_network_db_owner_console_preview_creator_governance_0919c46` - `f327c5b2...73a5`, created `2026-07-22T17:44:37.302Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-owner-console-preview`.
- `dzn_network_db_owner_console_preview_creator_governance_51815be` - `efb4127c...30ff`, created `2026-07-20T09:17:52.473Z`, latest use `2026-08-21T15:39:00.000Z`, `HANDOFF_REFERENCED_PROTECTED`, referenced by current handoffs as evidence-relevant.
- `dzn_network_db_discord_announcements_preview` - `f7d5eb47...fae6`, created `2026-07-08T13:39:03.983Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-discord-announcements-preview`.
- `dzn_network_db_discord_phase_2a_preview` - `83e3b565...ffb5`, created `2026-07-04T13:05:48.512Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-discord-phase-2a-preview`.
- `dzn_network_db_discord_control_preview` - `f6c76574...24d0`, created `2026-07-04T10:32:32.789Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-discord-control-preview`.
- `dzn_network_db_owner_console_preview` - `8434d3d7...b81b`, created `2026-07-04T00:08:10.553Z`, latest use `2026-08-21T15:39:00.000Z`, `RECENT_PREVIEW_PROTECTED`, referenced by a successful preview workflow within 30 days.
- `dzn_network_db_server_lifecycle_preview` - `692db1da...7ab4`, created `2026-07-02T01:59:34.911Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-server-lifecycle-preview`.
- `dzn_network_db_server_advertising_preview` - `1c17f68f...148b`, created `2026-06-28T08:09:51.416Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-server-advertising-preview`.
- `dzn_network_db_dzn_pulse_preview` - `e27a464f...d73a`, created `2026-06-26T06:42:45.776Z`, latest use `2026-08-21T15:39:00.000Z`, `ACTIVE_PAGES_BINDING`, bound to `dzn-network-pulse-preview`.
- `dzn_network_db` - `37515c66...975e`, created `2026-05-13T23:07:28.622Z`, latest use `2026-08-21T15:59:21.129Z`, `PRODUCTION_PROTECTED`, bound to production Pages and protected by configured production name/ID.

Pages binding evidence:

- `dzn-network`, branch `main`, latest deployment `2026-08-21T15:59:21.129Z`, latest success `2026-08-21T15:41:31.753Z`, `production:DB` and `preview:DB` both bound to `dzn_network_db` (`37515c66...975e`).
- `dzn-network-owner-console-preview`, branch `feature/creator-only-event-governance`, latest success `2026-08-20T12:13:47.105Z`, both environments bound to `dzn_network_db_owner_console_preview_creator_governance_0919c46` (`f327c5b2...73a5`).
- `dzn-network-discord-announcements-preview`, branch `main`, latest success `2026-07-22T11:40:54.083Z`, both environments bound to `dzn_network_db_discord_announcements_preview` (`f7d5eb47...fae6`).
- `dzn-network-discord-phase-2a-preview`, branch `feature/discord-control-phase-2a-ux`, latest success `2026-07-05T07:54:44.194Z`, both environments bound to `dzn_network_db_discord_phase_2a_preview` (`83e3b565...ffb5`).
- `dzn-network-discord-control-preview`, branch `feature/discord-control-centre`, latest success `2026-07-04T11:42:18.128Z`, both environments bound to `dzn_network_db_discord_control_preview` (`f6c76574...24d0`).
- `dzn-network-server-lifecycle-preview`, branch `feature/server-lifecycle-resource-control`, latest success `2026-07-02T20:01:06.620Z`, both environments bound to `dzn_network_db_server_lifecycle_preview` (`692db1da...7ab4`).
- `dzn-network-server-advertising-preview`, branch `feature/server-advertising-system`, latest success `2026-06-28T11:35:31.741Z`, both environments bound to `dzn_network_db_server_advertising_preview` (`1c17f68f...148b`).
- `dzn-network-pulse-preview`, branch `feature/dzn-pulse`, latest success `2026-06-27T11:09:23.845Z`, both environments bound to `dzn_network_db_dzn_pulse_preview` (`e27a464f...d73a`).

Artifact and result:

- Artifact name: `dzn-preview-d1-capacity-audit`.
- Artifact ID: `9453443289`.
- Artifact extraction path: `C:\Users\rafae\Desktop\DZN-Audits\d1-capacity-audits\github-read-only-32500704348\dzn-preview-d1-capacity-audit`.
- External job log path: `C:\Users\rafae\Desktop\DZN-Audits\d1-capacity-audits\github-read-only-32500704348\job-96829464256.log`.
- Artifact files reviewed: `audit-metadata.json`, `cleanup-candidate.json`, `d1-inventory.json`, `pages-bindings.json`, `protected-resources.json`, `summary.md`, `workflow-reference-summary.json`.
- Artifact security scan result: clean for complete D1 UUIDs, 32-character hex IDs, bearer values, Authorization headers, credential names/values, signed URLs, Location headers, and raw log fields.
- Job log review found only GitHub-masked `***` secret placeholders and no credential values or signed URLs.
- `candidate_selected=false`.
- No database satisfied every stale-candidate rule.
- No safe cleanup candidate was selected.
- No deletion occurred.
- No D1 creation occurred.
- No D1 SQL occurred.
- No migration was applied.
- No fixtures were seeded.
- No Pages project was created or modified.
- No Pages binding was changed.
- No Pages secret was written or deleted.
- No Pages deployment occurred.
- No Billing preview rerun occurred.
- No production action occurred.

## Next Authorised Slice

Investigate and repair the Billing Phase 1 preview schema failure where `linked_servers.merged_into_server_id` is missing after migrations through `0058`, then rerun the guarded Billing Phase 1 preview. No D1 deletion, preview cleanup, production deployment, production migration, production D1 write, Stripe change, main change, Event release branch change, or PR #15 change.
