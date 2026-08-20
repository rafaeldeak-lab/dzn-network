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
- Extracted script path check: passed. All 31 workflow script references exist.
- Line ending check: passed. Extracted scripts use LF.
- Executable permission check: passed. All 31 extracted scripts are invoked with `bash -e <script>`, so no executable bit is required.
- Shell syntax check with Git Bash `bash -n`: passed for all 31 scripts.
- Embedded Node heredoc syntax check with `node --check`: passed for 34 `NODE` heredocs.
- `npm run test:github-workflows`: passed.
- `npm run test:performance-foundation`: passed.
- `npm run lint`: passed with 12 existing warnings and 0 errors.
- `npx tsc --noEmit --pretty false`: failed on pre-existing `functions/api/onboarding/test.ts` `AdmImportJobProgressResult` property errors unrelated to this workflow refactor.
- Workflow-size scoped `git diff --check`: passed.
- Repository-wide `git diff --check`: currently blocked by unrelated onboarding whitespace in `functions/api/onboarding/save.ts`, which is outside this workflow-size refactor and was not staged.

## Dispatch Verification

The GitHub connector confirmed the remote `feature/event-platform-performance-foundation` ref contains `.github/workflows/dzn-owner-console-preview.yml`; however, this local refactor has not been committed or pushed yet, so GitHub cannot recognize the reduced workflow file remotely.

The local `gh` CLI is not installed, and the available GitHub connector tools in this session are read-oriented for this workflow case. I did not trigger any workflow dispatch.

Manual verification after commit/push:

1. Push this fix to `feature/event-platform-performance-foundation`.
2. Open GitHub Actions.
3. Select `DZN Owner Console Preview`.
4. Choose `Run workflow`.
5. Set `Use workflow from` to `feature/event-platform-performance-foundation`.
6. Use non-production preview inputs only, for example `mode=event-platform-performance-preview` and `confirm_event_platform_performance_preview=APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW`.
7. Confirm GitHub creates a workflow run and jobs instead of silently failing before queue creation.
