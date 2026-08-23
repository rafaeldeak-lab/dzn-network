# DZN Billing Phase 1 Integrity Handoff

## Completed Workflow-Size Incident

GitHub Support confirmed the `DZN Owner Console Preview` workflow was failing before job creation because `.github/workflows/dzn-owner-console-preview.yml` exceeded GitHub's 500 KB workflow file size limit on `feature/event-platform-performance-foundation`.

- Original workflow size: `515,947` bytes.
- Reduced workflow size: `16,367` bytes.
- Reduction: `96.83%`.
- Historical extraction: 31 inline script blocks were moved to `scripts/github-actions/dzn-owner-console-preview/*.sh`.
- Lossless reconstruction passed at the time of the repair.
- Successful non-production workflow run: `32367531730`.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32367531730`.
- Workflow-size implementation commit: `d5501dde1501c70d6ccb93dca8942876892f0869`.
- Final workflow validation documentation commit: `4da95f39929062e2d03e3ddf4f345618f300dca5`.
- Production deployment: none.

The current workflow may contain additional legitimate scripts after that incident; the historical extraction count remains 31.

## Billing Phase 1 Integrity Work

### Completed Before This Continuation

- `8db588f` `feat(billing): add linked server reservation lifecycle`
  - Added additive linked-server allowance reservation schema.
  - Added runtime reservation helpers.
  - Wired Nitrado validation, onboarding save, direct service attachment, and token-write failure paths to acquire, complete, or release reservations.
- `75d76f3` `fix(billing): align allowance reporting with reservations`
  - Added `getLinkedServerAllowanceUsageForUser`.
  - Updated billing status to report reservation-aware linked-server usage.
  - Added coverage for active, expired, released, and completed reservation accounting.

### Current Integrity Additions

- Billing migration collision resolved by renaming the billing migration to `migrations/0058_billing_phase_1_integrity.sql`.
- `migrations/0057_event_suggestions_phase_2a.sql` remains unchanged as migration `0057`.
- Nitrado token writes now update the exact connection for a linked server instead of creating uncontrolled duplicate token rows for repeated validation.
- Onboarding save resolves tokens by the validated linked server id and only uses a legacy fallback when exactly one candidate token/draft exists.
- Same-owner repeated linking reuses the canonical service row and cleans up the request draft.
- Cross-owner attempts to take over an already linked Nitrado service return a safe `409` conflict without exposing the other owner or token material.
- Setup verification reads the token associated with the current linked server instead of the latest token for the user.
- The `AdmImportJobProgressResult` setup summary now maps real fields: `job_id`, `filename`, line progress, chunks, status, and progress.

### Local Validation Status

In progress for this continuation:

- `npm run test:billing-integrity`
- `npm run test:billing-plans`
- `npm run test:github-workflows`
- `npm run test:performance-foundation`
- `npm run test:owner-console`
- `npm run test:dashboard-loading`
- `npm run test:dashboard-core-first-load`
- `npm run lint`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- `git diff --check`

### Security And Compatibility Notes

- No Stripe checkout, webhook, subscription pricing, Discord OAuth, production credential, production service, or live database path is intentionally changed.
- No destructive migration or data reset is added.
- No `player_stats` table is created; `player_profiles` is untouched.
- Endpoint authentication and authorization are not weakened.
- Runtime token storage remains encrypted and token material is not returned in API errors.
- Production activity remains blocked; preview work is guarded and non-production only.
