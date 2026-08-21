set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::37-deploy-billing-phase-1-preview-runtime.sh may only run in billing-phase-1-preview mode."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "dzn-network-owner-console-preview-billing-phase-1" ] || [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ]; then
  echo "::error::Billing preview deployment target is not the dedicated Billing preview Pages project."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "dzn-network" ]; then
  echo "::error::Refusing to deploy Billing preview to production Pages project."
  exit 1
fi
if [ "${CANDIDATE_BRANCH}" != "feature/event-platform-performance-foundation" ] || [ "${CANDIDATE_BRANCH}" = "main" ]; then
  echo "::error::Billing preview deployment branch must be feature/event-platform-performance-foundation and never main."
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "${CANDIDATE_SHA}" ]; then
  echo "::error::Billing preview deployment commit does not match CANDIDATE_SHA."
  exit 1
fi
if [ "${PREVIEW_BASE_URL}" != "https://dzn-network-owner-console-preview-billing-phase-1.pages.dev" ]; then
  echo "::error::Billing preview deployment stable URL must use the dedicated Billing preview project."
  exit 1
fi
if [ "${PREVIEW_BASE_URL}" = "https://dzn-network.pages.dev" ]; then
  echo "::error::Refusing production base URL for Billing preview deployment."
  exit 1
fi
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Refusing Billing preview deployment because preview D1 id equals production D1 id."
  exit 1
fi

test -s out/_worker.js
test -s out/_routes.json

BILLING_ARTIFACT_DIR="${BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR:-dzn-billing-phase-1-preview}"
DEPLOY_ROOT="${RUNNER_TEMP}/dzn-billing-phase-1-preview-deploy"
case "${DEPLOY_ROOT}" in
  "${RUNNER_TEMP}"/*) ;;
  *)
    echo "::error::Billing preview deployment root must stay inside RUNNER_TEMP."
    exit 1
    ;;
esac
rm -rf "${DEPLOY_ROOT}"
mkdir -p "${DEPLOY_ROOT}"
cp -R out "${DEPLOY_ROOT}/out"
test -s "${DEPLOY_ROOT}/out/_worker.js"
test -s "${DEPLOY_ROOT}/out/_routes.json"

RUNTIME_WORKER_SHA="$(sha256sum out/_worker.js | awk '{print $1}')"
DEPLOY_WORKER_SHA="$(sha256sum "${DEPLOY_ROOT}/out/_worker.js" | awk '{print $1}')"
if [ "${RUNTIME_WORKER_SHA}" != "${DEPLOY_WORKER_SHA}" ]; then
  echo "::error::Isolated Billing preview deploy worker does not match built out/_worker.js."
  exit 1
fi
if find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env | grep -q .; then
  echo "::error::Unapproved Wrangler or env configuration is deploy-visible for Billing preview."
  exit 1
fi
if [ -n "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ] && grep -R -F "${DETECTED_PRODUCTION_D1_DATABASE_ID}" "${DEPLOY_ROOT}" >/tmp/dzn-billing-preview-production-id-leak.txt 2>/dev/null; then
  echo "::error::Deployment-visible Billing preview output contains the production D1 UUID."
  cut -d: -f1 /tmp/dzn-billing-preview-production-id-leak.txt | sort -u | sed 's#^#blocked file category: #'
  exit 1
fi

cd "${DEPLOY_ROOT}"
"${GITHUB_WORKSPACE}/node_modules/.bin/wrangler" pages deploy out \
  --project-name "${PREVIEW_PROJECT_NAME}" \
  --branch "${CANDIDATE_BRANCH}" \
  --commit-hash "${CANDIDATE_SHA}" \
  --commit-message "Billing Phase 1 preview ${CANDIDATE_SHA}" \
  | tee billing-phase-1-preview-deploy.txt

if ! grep -F -- "--project-name ${PREVIEW_PROJECT_NAME}" billing-phase-1-preview-deploy.txt >/dev/null 2>&1; then
  echo "Billing preview deployment output captured for dedicated project ${PREVIEW_PROJECT_NAME}."
fi

node <<'NODE'
const fs = require("node:fs");
const projectName = process.env.PREVIEW_PROJECT_NAME;
const expectedProject = "dzn-network-owner-console-preview-billing-phase-1";
const stableUrl = `https://${projectName}.pages.dev`;
const text = fs.readFileSync("billing-phase-1-preview-deploy.txt", "utf8");
const urls = [...new Set((text.match(/https:\/\/[^\s"'<>]+?\.pages\.dev/g) ?? []).map((url) => url.replace(/[),.;]+$/, "")))];
const immutableUrl = urls.find((url) => url !== stableUrl) ?? "";
const candidateSha = process.env.CANDIDATE_SHA;
const branch = process.env.CANDIDATE_BRANCH;
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (projectName !== expectedProject) fail("Billing deploy project changed unexpectedly.");
if (stableUrl !== "https://dzn-network-owner-console-preview-billing-phase-1.pages.dev") fail("Billing stable URL mismatch.");
if (branch !== "feature/event-platform-performance-foundation") fail("Billing deploy branch changed unexpectedly.");
if (!/^[a-f0-9]{40}$/.test(candidateSha || "")) fail("Billing deploy candidate SHA is malformed.");
if (!immutableUrl) fail("Wrangler did not report an immutable Billing preview URL.");
for (const url of [stableUrl, immutableUrl]) {
  const parsed = new URL(url);
  if (parsed.hostname === "dzn-network.pages.dev" || parsed.hostname.endsWith(".dzn-network.pages.dev")) {
    fail("Billing preview deploy returned a production Pages URL.");
  }
  if (parsed.hostname !== `${expectedProject}.pages.dev` && !parsed.hostname.endsWith(`.${expectedProject}.pages.dev`)) {
    fail(`Billing preview deploy returned URL outside the dedicated project: ${parsed.hostname}`);
  }
}
fs.appendFileSync(process.env.GITHUB_ENV, [
  `BILLING_PHASE_1_IMMUTABLE_PREVIEW_URL=${immutableUrl}`,
  `BILLING_PHASE_1_STABLE_PREVIEW_URL=${stableUrl}`,
  "",
].join("\n"));
fs.writeFileSync(`${process.env.GITHUB_WORKSPACE}/${process.env.BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR || "dzn-billing-phase-1-preview"}/stable-vs-immutable-summary.json`, JSON.stringify({
  ok: true,
  projectName,
  stableUrl,
  immutableUrl,
  branch,
  candidateSha,
  deploymentProjectIsDedicatedBillingPreview: true,
}, null, 2));
console.log(`Billing immutable preview URL: ${immutableUrl}`);
console.log(`Billing stable preview URL: ${stableUrl}`);
NODE
