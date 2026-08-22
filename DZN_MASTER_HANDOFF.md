# DZN Master Handoff

Last updated: 2026-08-22

Repository: `rafaeldeak-lab/dzn-network`

Canonical remote development branch: `feature/event-platform-performance-foundation`

Canonical clean worktree for this recovery:

`C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-phase0-clean-20260820-155027`

## Branch State

- `main`: production branch. Verified Phase 0 recovery start SHA `71bce2199857093c576935beace91b9f26c20a84`.
- `feature/event-platform-performance-foundation`: active development branch and only source-of-truth branch for this programme. Phase 0 recovery start SHA `75d76f325521d33854974f1f71a07a4fe509bac6`.
- `release/event-platform-phase-2a`: Event Phase 2A release branch. Verified Phase 0 recovery start SHA `b96c755c682a287182c44a6267f0da5a740fff59`.
- PR #15: open and unmerged, base `main`, head `release/event-platform-phase-2a`.
- Divergence at recovery start: `origin/main...origin/feature/event-platform-performance-foundation = 4 46`.
- Divergence at recovery start: `origin/release/event-platform-phase-2a...origin/feature/event-platform-performance-foundation = 0 10`.
- Phase 0 recovery code commit: `96c40f7d648f0b16680dcb80b4d639c4c7157a2e`.
- Phase 0 recovery handoff commit: this document commit.
- Billing Phase 1 linked-server Nitrado integrity code commit: `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02`.
- Active remote SHA before Billing preview evidence documentation: `17b9535a695188218c10213d55265570cce15275`.
- Active remote SHA after read-only D1 capacity audit implementation: `4ec2fabfed53587970120c6f37757df3b9c11278`.
- Active remote SHA used by the corrected read-only D1 capacity audit: `9bcddfba11de8de4c3f185694eeec9d9c48b6700`.
- Active remote SHA after paid D1 capacity correction: `5615bbaafeb5016948ed25f5968afd6d70000218`.
- Active remote SHA after safe corrupted-credential classifier fix: `ba4a830dc0c42fc34148c72bb4b8e47b3b13d597`.
- Active remote SHA after expected safe HTTP-500 verifier fix: `1c30311a950a896368dec2353a6d027abb055d91`.
- Active remote SHA after linked-server-scoped setup verification repair: `1d8049b99622a869627c23d3e6c161811643a470`.
- Active remote SHA after exact `900003` Billing preview verifier repair: `a3677461b9db7096562e3402b37cb34aa3ec3c54`.
- Active remote SHA after Billing session-readiness repair: `0f18cbc787f0473c46b9ebae23773931ef746b9d`.

Old chat transcripts, interrupted Codex edits, and dirty local worktrees are not Git truth. Use remote branch history and committed files as the source of truth.

The preserved `feature/billing-phase-1-integrity` worktree contains interrupted broader billing-integrity work. It is backed up at:

`C:\Users\rafae\Desktop\DZN-Audits\backups\phase0-dirty-backup-20260820-151344`

Do not apply that preserved patch wholesale. Audit it selectively in a later authorised slice.

## Completed Platform Areas

High-level completed platform work includes ADM ingestion and diagnostics, owner dashboards, billing plan foundations, linked-server allowance reservations, public server and leaderboard presentation, event suggestion Phase 2A foundations, reputation and badge foundations, promotion and visibility systems, DZN Seasons, and Server Wars foundations.

## Billing State

Latest completed billing commits:

- `8db588f8562270ff2eb9a99c94442e9ff68ca639` - linked-server allowance reservation lifecycle.
- `75d76f325521d33854974f1f71a07a4fe509bac6` - reservation-aware linked-server allowance reporting.
- `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02` - linked-server Nitrado credential integrity.

Current billing state:

- Reservation lifecycle and reporting are committed on the active feature branch.
- Linked-server Nitrado credential lookup is now exact to authenticated owner and linked-server ID for targeted server-scoped onboarding and Nitrado routes.
- Cross-owner service conflicts are blocked with safe 409 `nitrado_service_already_linked` responses.
- Same-owner duplicate service linking reuses one canonical linked-server ID, safely reassigns same-owner credentials, retires temporary blank drafts as merged, and handles reservations deterministically.
- Client onboarding preserves `validatedLinkedServerId` through direct and browse-services flows and clears stale linked-server state when validation context changes.
- Event Suggestions remains migration `0057_event_suggestions_phase_2a.sql`.
- Billing Integrity is migration `0058_billing_phase_1_integrity.sql`.
- `npm run test:billing-integrity` is the canonical focused billing integrity suite.

Billing Phase 1 isolated preview result:

- Result: BLOCKED.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32457796161`.
- Run ID: `32457796161`; run number `56`; attempt `1`.
- Candidate commit: `17b9535a695188218c10213d55265570cce15275`.
- Isolated preview Pages project configured by the committed workflow: `dzn-network-owner-console-preview-billing-phase-1`.
- Stable preview URL configured by the committed workflow: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Candidate-specific preview D1 name: `dzn_network_db_owner_console_preview_billing_phase_1_17b9535`.
- Preview D1 status: not created or reused; the run stopped because the Cloudflare account had `10` D1 databases at the configured limit of `10` and the requested candidate-specific D1 did not exist.
- Immutable preview URL: not produced because Pages deployment was skipped after the D1 capacity blocker.
- Billing Phase 1 preview is not complete; migrations, schema verification, runtime deployment, endpoint verification, and Billing matrix checks did not run in this preview attempt.
- Artifact: `dzn-billing-phase-1-preview`, ID `9437848736`, extracted under `C:\Users\rafae\Desktop\DZN-Audits\preview-runs\billing-phase-1-17b9535-32457796161\dzn-billing-phase-1-preview`.
- Artifact secret scan was clean; no prohibited secret, credential, session, token, Authorization header, complete D1 UUID, or foreign-owner data was found.
- No workflow remediation was made because the blocker is an external preview D1 capacity precondition.

Billing Phase 1 paid-plan capacity rerun result:

- Result: FAILED.
- Owner-confirmed Cloudflare Workers Paid status was accepted as source of truth; no Cloudflare plan audit or plan change was run.
- Capacity guard correction commit: `5615bbaafeb5016948ed25f5968afd6d70000218` - `fix(preview): use Workers Paid D1 capacity limit`.
- Stale workflow guard changed from `D1_ACCOUNT_DATABASE_LIMIT: "10"` to `D1_ACCOUNT_DATABASE_LIMIT: "50000"`.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32513963281`.
- Run ID: `32513963281`; run number `60`; attempt `1`.
- Candidate commit: `5615bbaafeb5016948ed25f5968afd6d70000218`.
- Dedicated preview Pages project configured by the committed workflow: `dzn-network-owner-console-preview-billing-phase-1`.
- Stable preview URL configured by the committed workflow: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Immutable preview URL: not produced because Pages deployment was skipped.
- D1 count before creation: `10`.
- Configured D1 limit: `50000`.
- Candidate-specific preview D1 name: `dzn_network_db_owner_console_preview_billing_phase_1_5615bba`.
- Masked preview D1 ID: `a9f3c3d7...5b34`.
- Preview D1 status: created for this candidate; it was not a production-name or production-ID match.
- Migrations through `0058_billing_phase_1_integrity.sql` applied successfully; `0057_event_suggestions_phase_2a.sql` and `0058_billing_phase_1_integrity.sql` were both marked applied in order.
- Failure step: `Verify Billing Phase 1 preview schema`.
- Failure code: `BILLING_SCHEMA_REQUIRED_COLUMNS_MISSING`.
- Failure detail: `linked_servers` missing required column `merged_into_server_id`.
- Synthetic fixtures, Pages project configuration, Pages Functions worker build, isolated Pages deployment, stable/immutable URL verification, Billing matrix checks, onboarding test, ADM-path test, no-real-Nitrado check, no-Discord-send check, and runtime route checks did not run because schema verification failed first.
- Artifact: `dzn-billing-phase-1-preview`, ID `9458079667`, extracted under `C:\Users\rafae\Desktop\DZN-Audits\evidence\billing-paid-d1-preview-32513963281\artifact-9458079667`.
- Artifact security scan found no prohibited secret or credential values, no Authorization header, no complete D1 UUID, and no foreign-owner identity.
- Billing preview remains incomplete.
- No D1 deletion, preview cleanup, production D1 access/write, production migration, production deployment, production Pages mutation, production Worker mutation, Stripe change, Discord message, real Nitrado call, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, or force-push occurred.

Billing Phase 1 Slice 4E corrected preview result:

- Result: FAILED. Billing preview remains incomplete.
- Recovery worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-billing-merge-schema-20260821-221339`.
- Starting remote SHA: `fb478f46a49fa66323682b24b54151163e34f675`.
- Migration repair ancestor: `5313c0c33379bc3598e6f986132bbd4237d40894`.
- Fix commits:
  - `ba4a830dc0c42fc34148c72bb4b8e47b3b13d597` - `fix(onboarding): classify corrupted stored credentials safely`.
  - `1c30311a950a896368dec2353a6d027abb055d91` - `fix(preview): allow expected safe token-decrypt failure`.
- Local validation passed before dispatch: verifier shell syntax, `npm run test:billing-integrity`, `npm run test:github-workflows`, `npm run test:billing-plans`, `npx tsc --noEmit --pretty false`, `npm run lint`, `npm run build`, `npm test`, and `git diff --check`. Lint had 0 errors and the existing 4 warnings; the optional latest ADM raw fixture self-skipped for the existing missing local bundle reason.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32531896956`.
- Run ID: `32531896956`; run number `65`; attempt `1`; created `2026-08-21T22:11:16Z`; updated `2026-08-21T22:13:42Z`.
- Candidate SHA: `1c30311a950a896368dec2353a6d027abb055d91`.
- Preview D1: `dzn_network_db_owner_console_preview_billing_phase_1_1c30311`, masked ID `b8b466f9...d5c6`.
- Stable URL: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Immutable URL: `https://1838c1e9.dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Passed remote steps: D1 resolution/creation, migrations through `0059`, Billing schema verification, fixture seeding, Pages project resolution, auth secrets, runtime configuration, runtime build, Pages deployment, and artifact upload.
- Failed remote step: `Verify Billing Phase 1 preview`.
- Failure code: `BILLING_PREVIEW_HTTP_500`.
- Failure detail: `/api/onboarding/test` returned unexpected HTTP `500`.
- Billing matrix progress: public/runtime health, logged-out protection, service discovery, foreign/nonexistent linked-server protection, exact no-token protection, corrupted-token safe `500 token_decrypt_failed`, cross-owner `409`, same-owner canonical reuse, merge state, credential movement, duplicate reservation release, duplicate prevention, first-time `900003` claim, reservation completion, completed-hold accounting, and repeated-save idempotency passed through group `21`.
- Groups `23` through `30` did not run because group `22`, `Mock onboarding test works`, failed first.
- Artifact: `dzn-billing-phase-1-preview`, ID `9464181795`, extracted under `C:\Users\rafae\Desktop\DZN-Audits\preview-runs\billing-phase-1-1c30311-32531896956\artifact-9464181795`.
- Artifact security scan was clean for GitHub credential markers, Cloudflare token markers, `TOKEN_ENCRYPTION_KEY`, `SESSION_SECRET`, session cookies/tokens, raw Nitrado token markers, encrypted credential fields/values, Authorization/Bearer markers, full D1 UUIDs, stack traces, and real foreign-owner identity.
- Runtime flags remained preview safe: `MOCK_AUTH=true`, `MOCK_NITRADO=true`, `DZN_DISCORD_NOTIFICATIONS_ENABLED=false`, and `DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false`.
- Existing failed-preview D1s, including `5615bba`, `5313c0c`, `c2e685d`, `8899bfd`, `fb478f4`, and new `1c30311`, were retained.
- No production deployment, production migration, production D1 read/write, D1 deletion, preview cleanup, Stripe change, Discord send, real Nitrado call, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, or force-push occurred.

Billing Phase 1 Slice 4F-B linked-server-scoped preview result:

- Result: FAILED. Billing preview remains incomplete.
- Application repair commit: `1d8049b99622a869627c23d3e6c161811643a470` - `fix(onboarding): scope setup verification to linked server`.
- Preview verifier repair commit: `a3677461b9db7096562e3402b37cb34aa3ec3c54` - `fix(preview): target linked-server setup verification`.
- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-onboarding-test-repair-20260821-233045`, branch `fix/billing-onboarding-test-20260821-233045`.
- Starting and dispatched remote SHA: `a3677461b9db7096562e3402b37cb34aa3ec3c54`; both repair commits were ancestors.
- Local validation passed before dispatch: Billing verifier shell syntax, `npm run test:onboarding-verification`, `npm run test:billing-integrity`, `npm run test:github-workflows`, `npx tsc --noEmit --pretty false`, `npm run build`, and `git diff --check`.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32560877319`.
- Run ID: `32560877319`; run number `66`; attempt `1`; event `workflow_dispatch`; final conclusion `failure`.
- Candidate SHA: `a3677461b9db7096562e3402b37cb34aa3ec3c54`.
- Preview D1: `dzn_network_db_owner_console_preview_billing_phase_1_a367746`, masked ID `dd833756...c9ee`.
- Dedicated Pages project: `dzn-network-owner-console-preview-billing-phase-1`.
- Stable URL: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Immutable URL: `https://45babe62.dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Passed remote steps: input guards, Billing preflight, Cloudflare preview auth, isolated D1 resolution/creation, migrations through `0059`, schema verification, fixture seeding, Pages project resolution, auth secrets, runtime configuration, runtime build, Pages deployment, and artifact upload.
- Failed remote step: `Verify Billing Phase 1 preview`.
- Matrix progress: groups `1` through `3` passed. Group `4. Owned linked-server discovery succeeds` failed before it could be recorded as passed.
- Failure code: `BILLING_PREVIEW_UNEXPECTED_STATUS`.
- Failure detail: `GET /api/nitrado/services?linked_server_id=billing-phase1-preview-owner-a-canonical-900001` returned HTTP `401`, expected `200`; body preview was `{"error":"Authenticated user is required"}`.
- Exact group-22 `900003` setup verification was not reached in this run.
- Artifact: `dzn-billing-phase-1-preview`, ID `9472759931`, digest `sha256:ac54c19173ef7826ac382b30cd5cc21c83b502d3faf9ab9881d22de45c9495eb`, extracted under `C:\Users\rafae\Desktop\DZN-Audits\artifacts\billing-phase-1-preview-32560877319\extracted`.
- Job log retained at `C:\Users\rafae\Desktop\DZN-Audits\artifacts\billing-phase-1-preview-32560877319\job-97002107416.log`.
- Artifact security scan was clean for GitHub credentials, Cloudflare tokens, encryption/session secrets, session cookies/tokens, raw or encrypted Nitrado credential material, IV/auth tags, Authorization/Bearer headers, full D1 UUIDs, stack traces, foreign-owner identity, and signed download URLs.
- Runtime flags remained preview safe: `MOCK_AUTH=true`, `MOCK_NITRADO=true`, `DZN_PULSE_ENABLED=true`, `DZN_DISCORD_NOTIFICATIONS_ENABLED=false`, and `DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false`.
- Older failed candidate D1s for `5615bba`, `5313c0c`, `c2e685d`, `8899bfd`, `fb478f4`, and `1c30311` were retained.
- No production deployment, production migration, production D1 read/write, D1 deletion, preview cleanup, Stripe change, Discord send, real Nitrado call, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, or force-push occurred.

Billing Phase 1 Slice 4G-C final candidate preview result:

- Result: FAILED. Billing preview remains incomplete.
- Candidate commit: `0f18cbc787f0473c46b9ebae23773931ef746b9d` - `fix(preview): stabilize billing session readiness`.
- Verified ancestors: `1d8049b99622a869627c23d3e6c161811643a470`, `a3677461b9db7096562e3402b37cb34aa3ec3c54`, `e1a72f84480737233c3459a4aa8554156d7cae49`, and `0f18cbc787f0473c46b9ebae23773931ef746b9d`.
- Worktree: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-billing-preview-final-20260822-181142`, branch `audit/billing-preview-final-20260822-181142`; clean before dispatch.
- GitHub CLI was not required. Git Credential Manager `2.7.3+5fa7116896c82164996a609accd1c5ad90fe730a` supplied a cached credential for REST dispatch and polling; no credential value was printed or stored.
- Exactly one REST dispatch endpoint call was made. A local PowerShell no-content `Invoke-WebRequest` null-reference exception occurred after the POST, but exactly one matching workflow run appeared; no duplicate dispatch or rerun was made.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32587679222`.
- Run ID: `32587679222`; run number `67`; attempt `1`; event `workflow_dispatch`; final conclusion `failure`.
- Preview D1: `dzn_network_db_owner_console_preview_billing_phase_1_0f18cbc`, masked ID `d41e6645...6368`.
- Dedicated Pages project: `dzn-network-owner-console-preview-billing-phase-1`.
- Stable URL: `https://dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Immutable URL: `https://443351c7.dzn-network-owner-console-preview-billing-phase-1.pages.dev`.
- Passed remote steps: input guards, Billing preflight, Cloudflare preview auth, isolated D1 resolution, migrations through `0059`, schema verification, fixture seeding, Pages project resolution, auth secrets, runtime configuration, runtime build, Pages deployment, and artifact upload.
- Failed remote step: `Verify Billing Phase 1 preview`.
- Matrix progress: groups `1` through `21` were present exactly once and passed. Owner A/B session-row assertions passed, immutable Owner A/B readiness passed, and `matrixUrlClassification=immutable`.
- Failure code: `BILLING_PREVIEW_HTTP_500`.
- Failure detail: verifier group `22`, `Mock onboarding test works`, failed because `/api/onboarding/test` returned HTTP `500`.
- Stable Owner A/B readiness, final stable convergence, ADM-path testing, final no-real-Nitrado assertion, final no-Discord-send assertion, final ownership/allowance/stable-vs-immutable summaries, final foreign-key check, and final leakage checks were not reached after the first HTTP `500`.
- Artifact: `dzn-billing-phase-1-preview`, ID `9479509300`, extracted under `C:\Users\rafae\Desktop\DZN-Audits\artifacts\billing-phase-1-preview-final-20260822-182518\extracted`.
- Job log retained at `C:\Users\rafae\Desktop\DZN-Audits\artifacts\billing-phase-1-preview-final-20260822-182518\job-97066444090.log`.
- Required artifact files parsed: `candidate.json`, `summary.md`, `migration-summary.json`, `schema-summary.json`, `fixture-result-summary.json`, `endpoint-status-summary.json`, `ownership-integrity-summary.json`, `allowance-summary.json`, and `stable-vs-immutable-summary.json`.
- Artifact and job-log security scan was clean for unmasked GitHub credentials, Cloudflare tokens, encryption/session/Discord secret values, raw session cookie/token values, raw or encrypted Nitrado credential material, IV/auth tags, Authorization/Bearer values, complete D1 UUIDs, signed download URLs, and credential-bearing stack traces. Complete UUID-like log strings were reviewed as non-D1 runner/temp or synthetic linked-server IDs.
- Runtime flags remained preview safe: `MOCK_AUTH=true`, `MOCK_NITRADO=true`, `DZN_PULSE_ENABLED=true`, `DZN_DISCORD_NOTIFICATIONS_ENABLED=false`, and `DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false`.
- Older failed candidate D1s for `a367746`, `1c30311`, `fb478f4`, `8899bfd`, `c2e685d`, `5313c0c`, and `5615bba` were retained.
- No production deployment, production migration, production D1 SQL read/write, D1 deletion, preview cleanup, Stripe change, Discord send, real Nitrado call marker, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, force-push, or implementation change occurred.

Billing Phase 1 read-only D1 capacity audit result:

- Previous attempts remain recorded in `DZN_BILLING_PHASE_1_HANDOFF.md`: run `32498388093` failed on Cloudflare Pages list pagination, and run `32498659821` failed on GitHub job-log HTTP `415`.
- Corrected job-log redirect fix commit: `9bcddfba11de8de4c3f185694eeec9d9c48b6700` - `fix(preview): follow GitHub job-log redirects safely`.
- Corrected audit result: BLOCKED - NO PROVABLY SAFE CANDIDATE.
- Corrected run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32500704348`.
- Run ID `32500704348`; run number `59`; attempt `1`; final conclusion `success`.
- Active branch SHA used by the corrected audit: `9bcddfba11de8de4c3f185694eeec9d9c48b6700`.
- D1 count remained `10`.
- Pages projects checked: `8`; Pages D1 environment bindings checked: `16`.
- Workflow cross-reference checked `100` relevant runs and `106` jobs; `72` logs were available and `34` old signed log downloads were safely recorded as `signed_status_404` after bounded retry.
- Artifact: `dzn-preview-d1-capacity-audit`, ID `9453443289`, extracted under `C:\Users\rafae\Desktop\DZN-Audits\d1-capacity-audits\github-read-only-32500704348\dzn-preview-d1-capacity-audit`.
- Artifact security scan was clean for complete D1 IDs, credentials, Authorization headers, signed URLs, Location headers, and raw log fields.
- `candidate_selected=false`; no database satisfied every stale-candidate rule.
- D1 capacity remains blocked; no D1 deletion is authorized from the current evidence.
- Billing preview remains incomplete.
- Canonical worktree remains authoritative: `C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-phase0-clean-20260820-155027`.
- The preserved OneDrive worktree and named backups remain frozen.
- No D1 deletion, D1 creation, D1 SQL, migration, Pages mutation, Pages deployment, Billing preview rerun, production D1 read/write, production Pages mutation, production Worker mutation, secret change, Stripe change, Discord send, real Nitrado call, ADM production trigger, scheduler trigger, advertising trigger, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, or force-push occurred.

## Phase 0 Recovery

This Phase 0 recovery resolved:

- duplicate migration prefix collision between Event Suggestions and Billing Integrity;
- stale Billing Integrity migration filename references;
- missing `test:billing-integrity` package script;
- setup ADM backfill mapper drift against `AdmImportJobProgressResult`;
- missing regression coverage for migration numbering/order/application and setup mapper states;
- absence of a top-level programme handoff.

No deployment, preview workflow dispatch, production workflow dispatch, remote migration, production D1 access, production D1 write, D1 bookmark, secret change, Stripe change, Discord flag change, Discord send, ADM trigger, Nitrado trigger, or scheduler trigger occurred in Phase 0 recovery.

## Production Runtime Warning

Production Pages stable-alias and runtime health must be verified from the deployed runtime, not inferred from Git history. Treat any stable alias, Cloudflare Pages environment, Worker schedule, and runtime secret state as unverified until checked in a separately authorised production-health slice.

## Current Hard Blockers

The repository blockers targeted by Phase 0 are resolved after validation and push. The linked-server Nitrado integrity slice is complete in code commit `a9fd8f7be01637fbcd6e6b1f06ffaf23886ceb02`. The stale Free-plan D1 guard was corrected for the owner-confirmed Workers Paid account in `5615bbaafeb5016948ed25f5968afd6d70000218`. The migration repair commit `5313c0c33379bc3598e6f986132bbd4237d40894` added `0059_linked_server_merge_state.sql`, and the Slice 4E commits `ba4a830dc0c42fc34148c72bb4b8e47b3b13d597` and `1c30311a950a896368dec2353a6d027abb055d91` resolved the corrupted-token safe HTTP `500` contract.

The latest guarded Billing Phase 1 preview run for candidate `0f18cbc787f0473c46b9ebae23773931ef746b9d` created the candidate-specific D1, applied migrations through `0059`, passed Billing schema verification, seeded fixtures, built and deployed the runtime, and passed verifier groups `1` through `21`. Billing preview remains incomplete because verifier group `22`, `Mock onboarding test works`, failed when `/api/onboarding/test` returned HTTP `500`.

The canonical clean worktree remains authoritative:

`C:\Users\rafae\Desktop\DZN-Audits\worktrees\dzn-phase0-clean-20260820-155027`

The older dirty worktree and backups remain frozen and were not modified:

- `C:\Users\rafae\OneDrive\Desktop\DZN-Network`
- `C:\Users\rafae\Desktop\DZN-Audits\backups\phase0-dirty-backup-20260820-151344`
- `C:\Users\rafae\Desktop\DZN-Audits\backups\phase1-linked-server-integrity-20260820-165515`
- `C:\Users\rafae\Desktop\DZN-Audits\backups\billing-preview-4a-finalisation-20260821-013400`

No preview, deployment, production workflow dispatch, remote migration, production D1 access/write, D1 bookmark, secret/env change, Stripe change, Discord flag/message, ADM trigger, Nitrado trigger, scheduler trigger, or advertising trigger occurred in the linked-server integrity slice.

No production deployment, production migration, production D1 SQL read/write, production Pages mutation, production Worker mutation, production secret change, D1 deletion, preview cleanup, main change, Event release branch change, PR #15 change, rebase, merge, cherry-pick, reset, stash, clean, force-push, Stripe change, Discord flag enablement, Discord message, real Nitrado token use, real Nitrado call marker, ADM production trigger, scheduler trigger, advertising trigger, or protected-data deletion/reset occurred in the Billing preview dispatch slices.

The canonical clean worktree remained authoritative and clean before the evidence documentation update. The older dirty worktree remained on `feature/billing-phase-1-integrity` at `75d76f325521d33854974f1f71a07a4fe509bac6` and was not modified.

## Next Authorised Slice

Investigate the Billing Phase 1 preview verifier group `22`, `Mock onboarding test works`, where `/api/onboarding/test` returned HTTP `500` in run `32587679222` for candidate `0f18cbc787f0473c46b9ebae23773931ef746b9d`. Determine whether the issue is route behavior, preview fixture shape, mock session handling, or verifier expectation, and prepare the narrowest tested correction only. Treat auth/session changes as high risk, preserve logged-out `401`, foreign-owner `404`, and existing 401/403 endpoint protection, and do not rerun a guarded `billing-phase-1-preview` until a separate explicit authorization. No D1 deletion, preview cleanup, production deployment, production migration, production D1 write, Stripe change, main change, Event release branch change, or PR #15 change.

## Deferred Areas

- release reconciliation;
- production runtime health;
- final pricing and Stripe contract;
- Discord enablement;
- Operators integration;
- individual movement map;
- Invite Tracker-style visuals;
- cinematic event notifications;
- Server Wars completion.

## Non-Negotiable Rules

- No destructive migrations.
- Do not reset or delete `player_profiles`, kills, deaths, events, sessions, subscriptions, or historical rows.
- Do not create `player_stats`; DZN uses `player_profiles`.
- Do not weaken 401 or 403 endpoint protection.
- Do not expose or copy secrets.
- Do not copy Cloudflare runtime secrets into GitHub.
- Do not make GitHub the primary ADM auto-sync runner.
- Preserve same-category matchmaking enforcement.
- Treat auth, Discord OAuth, Stripe, Nitrado token handling, sync workers, ADM ingestion, and Cloudflare Worker infrastructure as protected systems.
- All changes affecting billing, subscriptions, achievements, reputation, badges, visibility, rankings, or profiles require tests.

## Related Handoffs And Roadmaps

- [DZN Billing Phase 1 Handoff](DZN_BILLING_PHASE_1_HANDOFF.md)
- [Performance Architecture](docs/performance-architecture.md)
- [Event Tournament Roadmap](docs/event-tournament-roadmap.md)
- [Billing Plans](docs/BILLING_PLANS.md)
- [Automation Setup](docs/AUTOMATION_SETUP.md)
- [Sync System Map](docs/SYNC_SYSTEM_MAP.md)
- [Secrets Matrix](docs/SECRETS_MATRIX.md)
- [Dashboard Button Map](docs/DASHBOARD_BUTTON_MAP.md)
- [DZN Seasons System](docs/DZN_SEASONS_SYSTEM.md)
- [Premium Visibility System](docs/PREMIUM_VISIBILITY_SYSTEM.md)
- [Visual Loadout System](docs/VISUAL_LOADOUT_SYSTEM.md)
- [Badge Asset System](docs/BADGE_ASSET_SYSTEM.md)
- [Badge Awarding System](docs/BADGE_AWARDING_SYSTEM.md)
- [Pandora Bot Tracking Review](docs/PANDORA_BOT_TRACKING_REVIEW.md)
