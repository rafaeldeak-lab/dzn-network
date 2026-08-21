set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::32-preflight-billing-phase-1-preview.sh may only run in billing-phase-1-preview mode."
  exit 1
fi

BILLING_ARTIFACT_DIR="dzn-billing-phase-1-preview"
BILLING_PROJECT="${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}"
BILLING_DB_NAME="${BILLING_PHASE_1_PREVIEW_DB_PREFIX}${OWNER_CONSOLE_CANDIDATE_SHORT_SHA}"
BILLING_STABLE_URL="${BILLING_PHASE_1_PREVIEW_STABLE_URL}"

if [ "${CANDIDATE_BRANCH}" != "feature/event-platform-performance-foundation" ]; then
  echo "::error::Billing Phase 1 preview may only run from feature/event-platform-performance-foundation."
  exit 1
fi
if [ "${CONFIRM_PREVIEW_ONLY}" != "PREVIEW_ONLY" ]; then
  echo "::error::confirm_preview_only must equal PREVIEW_ONLY."
  exit 1
fi
if [ "${CONFIRM_BILLING_PHASE_1_PREVIEW}" != "${BILLING_PHASE_1_PREVIEW_CONFIRMATION}" ]; then
  echo "::error::confirm_billing_phase_1_preview must equal APPROVE_BILLING_PHASE_1_PREVIEW."
  exit 1
fi
if [ "${BILLING_PHASE_1_PREVIEW_CONFIRMATION}" != "APPROVE_BILLING_PHASE_1_PREVIEW" ]; then
  echo "::error::Billing Phase 1 preview confirmation constant mismatch."
  exit 1
fi
if [ "${BILLING_PROJECT}" != "dzn-network-owner-console-preview-billing-phase-1" ]; then
  echo "::error::Billing Phase 1 preview project constant mismatch."
  exit 1
fi
if [ "${BILLING_PHASE_1_PREVIEW_DB_PREFIX}" != "dzn_network_db_owner_console_preview_billing_phase_1_" ]; then
  echo "::error::Billing Phase 1 preview D1 prefix constant mismatch."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PROJECT}" ]; then
  echo "::error::Billing Phase 1 preview project must be the dedicated Billing preview Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" != "${BILLING_DB_NAME}" ]; then
  echo "::error::Billing Phase 1 preview D1 name must be derived from the candidate short SHA."
  exit 1
fi
if ! [[ "${PREVIEW_DB_NAME}" =~ ^dzn_network_db_owner_console_preview_billing_phase_1_[a-f0-9]{7}$ ]]; then
  echo "::error::Billing Phase 1 preview D1 name is malformed."
  exit 1
fi
if [ "${PREVIEW_BASE_URL}" != "${BILLING_STABLE_URL}" ] || [ "${BILLING_STABLE_URL}" != "https://dzn-network-owner-console-preview-billing-phase-1.pages.dev" ]; then
  echo "::error::Billing Phase 1 preview stable URL mismatch."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "dzn-network" ]; then
  echo "::error::Refusing Billing Phase 1 preview for production Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing Billing Phase 1 preview for production D1 database name."
  exit 1
fi

CHECKED_OUT_HEAD="$(git rev-parse HEAD)"
CHECKED_OUT_TREE="$(git rev-parse "HEAD^{tree}")"
if [ "${CHECKED_OUT_HEAD}" != "${CANDIDATE_SHA}" ]; then
  echo "::error::Checked-out commit does not match CANDIDATE_SHA."
  exit 1
fi
git fetch origin "${CANDIDATE_BRANCH}:refs/remotes/origin/${CANDIDATE_BRANCH}" --depth=1
REMOTE_FEATURE_HEAD="$(git rev-parse "origin/${CANDIDATE_BRANCH}")"
if [ "${REMOTE_FEATURE_HEAD}" != "${CANDIDATE_SHA}" ]; then
  echo "::error::Billing candidate SHA is not the current remote branch head."
  exit 1
fi

rm -rf "${BILLING_ARTIFACT_DIR}"
mkdir -p "${BILLING_ARTIFACT_DIR}"

TOKEN_ENCRYPTION_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
BILLING_OWNER_A_SESSION_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")"
BILLING_OWNER_B_SESSION_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))")"
echo "::add-mask::${TOKEN_ENCRYPTION_KEY}"
echo "::add-mask::${BILLING_OWNER_A_SESSION_TOKEN}"
echo "::add-mask::${BILLING_OWNER_B_SESSION_TOKEN}"
echo "::add-mask::dzn_session=${BILLING_OWNER_A_SESSION_TOKEN}"
echo "::add-mask::dzn_session=${BILLING_OWNER_B_SESSION_TOKEN}"

{
  printf "TOKEN_ENCRYPTION_KEY=%s\n" "${TOKEN_ENCRYPTION_KEY}"
  printf "BILLING_OWNER_A_SESSION_TOKEN=%s\n" "${BILLING_OWNER_A_SESSION_TOKEN}"
  printf "BILLING_OWNER_B_SESSION_TOKEN=%s\n" "${BILLING_OWNER_B_SESSION_TOKEN}"
  printf "BILLING_OWNER_A_COOKIE=dzn_session=%s\n" "${BILLING_OWNER_A_SESSION_TOKEN}"
  printf "BILLING_OWNER_B_COOKIE=dzn_session=%s\n" "${BILLING_OWNER_B_SESSION_TOKEN}"
  printf "MOCK_AUTH=true\n"
  printf "MOCK_NITRADO=true\n"
  printf "DZN_PULSE_ENABLED=true\n"
  printf "DZN_DISCORD_NOTIFICATIONS_ENABLED=false\n"
  printf "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED=false\n"
  printf "BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR=%s\n" "${BILLING_ARTIFACT_DIR}"
  printf "BILLING_PHASE_1_STABLE_PREVIEW_URL=%s\n" "${BILLING_STABLE_URL}"
} >> "$GITHUB_ENV"

npm run test:github-workflows
npm run test:billing-integrity

node <<'NODE'
const fs = require("node:fs");
const artifact = "dzn-billing-phase-1-preview";
const summary = {
  mode: "billing-phase-1-preview",
  branch: process.env.CANDIDATE_BRANCH,
  candidateSha: process.env.CANDIDATE_SHA,
  candidateTreeSha: process.env.OWNER_CONSOLE_CANDIDATE_TREE_SHA,
  remoteBranchHead: process.env.OWNER_CONSOLE_REMOTE_BRANCH_HEAD,
  projectName: process.env.PREVIEW_PROJECT_NAME,
  d1Name: process.env.PREVIEW_DB_NAME,
  stableUrl: process.env.PREVIEW_BASE_URL,
  mockAuth: true,
  mockNitrado: true,
  dznPulseEnabled: true,
  discordNotificationsEnabled: false,
  discordServerAnnouncementsEnabled: false,
  localSafetyTests: ["npm run test:github-workflows", "npm run test:billing-integrity"],
  secretStrategy: "Ephemeral TOKEN_ENCRYPTION_KEY and owner session tokens are masked and scoped to this workflow environment only.",
};
fs.writeFileSync(`${artifact}/candidate.json`, JSON.stringify(summary, null, 2));
fs.writeFileSync(`${artifact}/summary.md`, [
  "## Billing Phase 1 Preview",
  "",
  `- Mode: ${summary.mode}`,
  `- Branch: ${summary.branch}`,
  `- Candidate SHA: ${summary.candidateSha}`,
  `- Candidate tree SHA: ${summary.candidateTreeSha}`,
  `- Preview project: ${summary.projectName}`,
  `- Preview D1 name: ${summary.d1Name}`,
  `- Stable URL: ${summary.stableUrl}`,
  "- MOCK_AUTH: true",
  "- MOCK_NITRADO: true",
  "- DZN_PULSE_ENABLED: true",
  "- DZN_DISCORD_NOTIFICATIONS_ENABLED: false",
  "- DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: false",
  "- Local safety tests before remote mutation: passed",
  "- Secret values written to artifact: false",
].join("\n") + "\n");
NODE

{
  echo "## Billing Phase 1 Preview Preflight"
  echo ""
  echo "- Mode: billing-phase-1-preview"
  echo "- Branch: ${CANDIDATE_BRANCH}"
  echo "- Candidate SHA: ${CANDIDATE_SHA}"
  echo "- Candidate tree SHA: ${CHECKED_OUT_TREE}"
  echo "- Remote branch HEAD: ${REMOTE_FEATURE_HEAD}"
  echo "- Preview project: ${PREVIEW_PROJECT_NAME}"
  echo "- Preview D1 name: ${PREVIEW_DB_NAME}"
  echo "- Stable URL: ${PREVIEW_BASE_URL}"
  echo "- Runtime flags: MOCK_AUTH=true, MOCK_NITRADO=true, DZN_PULSE_ENABLED=true, Discord flags=false"
  echo "- Ephemeral secret values: generated, masked, and not printed"
} >> "$GITHUB_STEP_SUMMARY"
