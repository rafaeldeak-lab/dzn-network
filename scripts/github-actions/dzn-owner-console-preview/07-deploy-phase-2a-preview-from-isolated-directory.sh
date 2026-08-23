set -euo pipefail

if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" != "dzn-network-owner-console-preview" ] || [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Phase 2A deploy target is not the fixed preview Pages project."
  exit 1
fi
if [ "${PHASE2A_PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Phase 2A deploy blocked because preview D1 id equals production D1 id."
  exit 1
fi
test -s out/_worker.js
test -s out/_routes.json

DEPLOY_ROOT="${RUNNER_TEMP}/dzn-phase2a-preview-deploy"
case "${DEPLOY_ROOT}" in
  "${RUNNER_TEMP}"/*) ;;
  *)
    echo "::error::Phase 2A deployment root must stay inside RUNNER_TEMP."
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
  echo "::error::Isolated Phase 2A deploy worker does not match built out/_worker.js."
  exit 1
fi
if find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env | grep -q .; then
  echo "::error::Unapproved Wrangler or env configuration is deploy-visible for Phase 2A preview."
  find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env | sed 's#^#blocked config path: #'
  exit 1
fi
if [ -n "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ] && grep -R -F "${DETECTED_PRODUCTION_D1_DATABASE_ID}" "${DEPLOY_ROOT}" >/tmp/dzn-phase2a-production-id-leak.txt 2>/dev/null; then
  echo "::error::Deployment-visible Phase 2A output contains the production D1 UUID."
  cut -d: -f1 /tmp/dzn-phase2a-production-id-leak.txt | sort -u | sed 's#^#blocked file category: #'
  exit 1
fi
CONFIG_CANDIDATES="$(find "${DEPLOY_ROOT}" \( -name '*.toml' -o -name 'wrangler.json' -o -name 'wrangler.jsonc' -o -name '.dev.vars' -o -name '.env' \) -print)"
if [ -n "${CONFIG_CANDIDATES}" ] && printf '%s\n' "${CONFIG_CANDIDATES}" | xargs grep -E 'name[[:space:]]*=[[:space:]]*"dzn-network"|database_name[[:space:]]*=[[:space:]]*"dzn_network_db"' >/tmp/dzn-phase2a-production-assignment-leak.txt 2>/dev/null; then
  echo "::error::Deployment-visible Phase 2A configuration contains production project or D1 assignment syntax."
  cut -d: -f1 /tmp/dzn-phase2a-production-assignment-leak.txt | sort -u | sed 's#^#blocked config category: #'
  exit 1
fi

cd "${DEPLOY_ROOT}"
"${GITHUB_WORKSPACE}/node_modules/.bin/wrangler" pages deploy out \
  --project-name "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" \
  --branch "${PHASE2A_PREVIEW_PROJECT_BRANCH}" \
  --commit-hash "${CANDIDATE_SHA}" \
  --commit-message "Event platform performance preview ${CANDIDATE_SHA}" \
  | tee phase2a-preview-deploy.txt

node <<'NODE'
const fs = require("node:fs");
const projectName = process.env.EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME;
const stableUrl = `https://${projectName}.pages.dev`;
const text = fs.readFileSync("phase2a-preview-deploy.txt", "utf8");
const urls = [...new Set((text.match(/https:\/\/[^\s"'<>]+?\.pages\.dev/g) ?? []).map((url) => url.replace(/[),.;]+$/, "")))];
const immutableUrl = urls.find((url) => url !== stableUrl) ?? "";
if (!immutableUrl) throw new Error("Wrangler did not report an immutable Phase 2A preview URL.");
fs.appendFileSync(process.env.GITHUB_ENV, [
  `PHASE2A_IMMUTABLE_PREVIEW_URL=${immutableUrl}`,
  `PHASE2A_STABLE_PREVIEW_URL=${stableUrl}`,
  "",
].join("\n"));
fs.writeFileSync(`${process.env.GITHUB_WORKSPACE}/dzn-event-platform-performance-preview/deploy-summary.json`, JSON.stringify({
  project: projectName,
  stableUrl,
  immutableUrl,
  branch: process.env.PHASE2A_PREVIEW_PROJECT_BRANCH,
  commit: process.env.CANDIDATE_SHA,
}, null, 2));
console.log(`Phase 2A immutable preview URL: ${immutableUrl}`);
console.log(`Phase 2A stable preview URL: ${stableUrl}`);
NODE
