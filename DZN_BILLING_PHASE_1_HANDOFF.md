# DZN Owner Console Preview Workflow Size Handoff

## Root Cause

GitHub Support confirmed the `DZN Owner Console Preview` workflow was failing before job creation because `.github/workflows/dzn-owner-console-preview.yml` exceeded GitHub's 500 KB workflow file size limit on the dispatched branch/ref.

The default branch copy was not the failing version. The oversized workflow was confirmed on `feature/event-platform-performance-foundation`, which tracks `origin/feature/event-platform-performance-foundation`.

## Refactor

- Reduced `.github/workflows/dzn-owner-console-preview.yml` from `515,947` bytes to `16,367` bytes.
- Reduction: `96.83%`.
- Extracted all 31 inline `run: |` script blocks into `scripts/github-actions/dzn-owner-console-preview/*.sh`.
- Kept workflow dispatch inputs, permissions, job env, secrets/vars references, step ordering, `if:` expressions, artifact upload, preview deploy, and safety guards intact.
- Updated workflow tests so existing assertions expand the extracted scripts before checking behavior.

## Validation

- Lossless reconstruction check: passed. Re-expanding the extracted scripts matched the original workflow byte size and SHA-256 exactly.
- Workflow expression check: passed. All 54 `${{ ... }}` expression lines match the original workflow.
- YAML parse check with `js-yaml`: passed.
- Extracted script path check: passed. All 31 workflow script references exist with exact case-sensitive spelling.
- Line ending check: passed. Extracted scripts use LF.
- Executable permission check: passed. All 31 extracted scripts are invoked with `bash -e <script>`, so no executable bit is required.
- Shell syntax check with Git Bash `bash -n`: passed for all 31 scripts.
- Embedded Node heredoc syntax check with `node --check`: passed for 34 `NODE` heredocs.
- `npm run test:github-workflows`: passed.
- `npm run test:performance-foundation`: passed.
- `npm run lint`: passed with 12 existing warnings and 0 errors.
- `npx tsc --noEmit --pretty false`: failed only on the known untouched `functions/api/onboarding/test.ts` `AdmImportJobProgressResult` property errors (`adm_file`, `id`, `line_start`, `line_end`).
- Workflow-size staged `git diff --check`: passed.
- Repository-wide `git diff --check`: passed on the final check after dispatch verification documentation.

## Remote Verification

Implementation commit: `d5501dde1501c70d6ccb93dca8942876892f0869`.

Pushed branch: `origin/feature/event-platform-performance-foundation`.

Remote verification after push:

- Remote branch head after implementation push: `d5501dde1501c70d6ccb93dca8942876892f0869`.
- Remote workflow size: `16,367` bytes.
- Remote workflow SHA-256 matched the local reduced workflow.
- Remote workflow is below GitHub's 500 KB workflow-file-size limit.

## Dispatch Verification

- Dispatch method: GitHub REST API workflow-dispatch endpoint using the local git credential helper. The local `gh` CLI was not installed and `GH_TOKEN`/`GITHUB_TOKEN` were not present.
- Workflow: `.github/workflows/dzn-owner-console-preview.yml`.
- Ref: `feature/event-platform-performance-foundation`.
- Inputs:
  - `mode=event-platform-performance-preview`
  - `confirm_preview_only=PREVIEW_ONLY`
  - `preview_db_name_to_delete=`
  - `cleanup_action=dry-run`
  - `reviewed_preview_db_id_mask=`
  - `confirm_preview_db_cleanup=`
  - `rebind_action=dry-run`
  - `confirm_preview_d1_rebind=`
  - `repair_action=dry-run`
  - `confirm_rebound_discord_preview_repair=`
  - `confirm_existing_creator_governance_preview=`
  - `confirm_event_platform_performance_preview=APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW`
- Run ID: `32367531730`.
- Run URL: `https://github.com/rafaeldeak-lab/dzn-network/actions/runs/32367531730`.
- Event: `workflow_dispatch`.
- Branch: `feature/event-platform-performance-foundation`.
- Head SHA: `d5501dde1501c70d6ccb93dca8942876892f0869`.
- Created at: `2026-08-20T12:11:11Z`.
- Job created: yes, `owner-console-preview` job ID `96420273448`.
- Final run conclusion: `success`.
- Artifact uploaded: `dzn-event-platform-performance-preview`, artifact ID `9405960687`, size `25,675` bytes.
- Failed job/step: none.
- Production deployment: none. The run used the guarded non-production Phase 2A preview path and deployed only the preview Pages project.
- Manual action remaining for the workflow-size issue: none.
