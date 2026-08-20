set -euo pipefail

git fetch --no-tags --prune origin "+refs/heads/main:refs/remotes/origin/main" --depth=1
CURRENT_MAIN_SHA="$(git rev-parse origin/main)"
if [ "${CURRENT_MAIN_SHA}" != "${APPROVED_MAIN_RUNTIME_SHA}" ]; then
  echo "::error::origin/main moved. Expected ${APPROVED_MAIN_RUNTIME_SHA}, got ${CURRENT_MAIN_SHA}."
  exit 1
fi
if [ -e runtime-main ]; then
  echo "::error::runtime-main checkout path already exists."
  exit 1
fi
git worktree add --detach runtime-main "${APPROVED_MAIN_RUNTIME_SHA}"
RUNTIME_HEAD="$(git -C runtime-main rev-parse HEAD)"
RUNTIME_TREE="$(git -C runtime-main rev-parse "HEAD^{tree}")"
if [ "${RUNTIME_HEAD}" != "${APPROVED_MAIN_RUNTIME_SHA}" ]; then
  echo "::error::Pinned repair runtime checkout does not match approved main SHA."
  exit 1
fi
printf "REPAIR_RUNTIME_TREE_SHA=%s\n" "${RUNTIME_TREE}" >> "$GITHUB_ENV"
{
  echo ""
  echo "## Rebound Discord Preview Repair Runtime"
  echo ""
  echo "- Workflow source branch: ${CANDIDATE_BRANCH}"
  echo "- Workflow source SHA: ${CANDIDATE_SHA}"
  echo "- Runtime source SHA: ${RUNTIME_HEAD}"
  echo "- Runtime source tree: ${RUNTIME_TREE}"
} >> "$GITHUB_STEP_SUMMARY"
