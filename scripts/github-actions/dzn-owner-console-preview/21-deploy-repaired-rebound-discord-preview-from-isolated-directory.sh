set -euo pipefail

if [ "${REPAIR_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing to deploy production Pages project from repair mode."
  exit 1
fi
if [ "$(git -C runtime-main rev-parse HEAD)" != "${APPROVED_MAIN_RUNTIME_SHA}" ]; then
  echo "::error::Runtime checkout changed before repair deploy."
  exit 1
fi
if [ "${DZN_DISCORD_NOTIFICATIONS_ENABLED}" != "false" ] || [ "${DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED}" != "false" ]; then
  echo "::error::Discord flags must remain false for repair deployment."
  exit 1
fi
if [ -z "${OWNER_CONSOLE_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}" ]; then
  echo "::error::Missing Cloudflare API token for repair deployment."
  exit 1
fi
export CLOUDFLARE_API_TOKEN="${OWNER_CONSOLE_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
if [ ! -s runtime-main/out/_worker.js ]; then
  echo "::error::Compiled Pages Functions worker is missing from runtime-main/out."
  exit 1
fi
if [ ! -s runtime-main/out/_routes.json ]; then
  echo "::error::Cloudflare Pages routes are missing from runtime-main/out."
  exit 1
fi

DEPLOY_ROOT="${RUNNER_TEMP}/dzn-discord-preview-deploy"
case "${DEPLOY_ROOT}" in
  "${RUNNER_TEMP}"/*) ;;
  *)
    echo "::error::Repair deployment root must stay inside RUNNER_TEMP."
    exit 1
    ;;
esac
rm -rf "${DEPLOY_ROOT}"
mkdir -p "${DEPLOY_ROOT}"
cp -R runtime-main/out "${DEPLOY_ROOT}/out"
test -s "${DEPLOY_ROOT}/out/_worker.js"
test -s "${DEPLOY_ROOT}/out/_routes.json"
RUNTIME_WORKER_SHA="$(sha256sum runtime-main/out/_worker.js | awk '{print $1}')"
DEPLOY_WORKER_SHA="$(sha256sum "${DEPLOY_ROOT}/out/_worker.js" | awk '{print $1}')"
if [ "${RUNTIME_WORKER_SHA}" != "${DEPLOY_WORKER_SHA}" ]; then
  echo "::error::Isolated deploy worker does not match runtime-main/out/_worker.js."
  exit 1
fi

if find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env | grep -q .; then
  echo "::error::Unapproved Wrangler or env configuration is deploy-visible."
  find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env | sed 's#^#blocked config path: #'
  exit 1
fi
if [ "${REPAIR_PREVIEW_PROJECT_NAME}" != "dzn-network-discord-announcements-preview" ] || [ "${REPAIR_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Repair deploy target is not the fixed preview Pages project."
  exit 1
fi
if [ -n "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ] && grep -R -F "${DETECTED_PRODUCTION_D1_DATABASE_ID}" "${DEPLOY_ROOT}" >/tmp/dzn-repair-production-id-leak.txt 2>/dev/null; then
  echo "::error::Deployment-visible output contains the production D1 ID."
  cut -d: -f1 /tmp/dzn-repair-production-id-leak.txt | sort -u | sed 's#^#blocked file category: #'
  exit 1
fi
CONFIG_CANDIDATES="$(find "${DEPLOY_ROOT}" \( -name '*.toml' -o -name 'wrangler.json' -o -name 'wrangler.jsonc' -o -name '.dev.vars' -o -name '.env' \) -print)"
if [ -n "${CONFIG_CANDIDATES}" ] && printf '%s\n' "${CONFIG_CANDIDATES}" | xargs grep -E 'name[[:space:]]*=[[:space:]]*"dzn-network"|database_name[[:space:]]*=[[:space:]]*"dzn_network_db"' >/tmp/dzn-repair-production-assignment-leak.txt 2>/dev/null; then
  echo "::error::Deployment-visible configuration contains production project or D1 assignment syntax."
  cut -d: -f1 /tmp/dzn-repair-production-assignment-leak.txt | sort -u | sed 's#^#blocked config category: #'
  exit 1
fi
echo "Deployment-visible worker and route package verified: workerShaPrefix=${DEPLOY_WORKER_SHA:0:12}"
echo "Deployment-visible configuration scan passed."

cd "${DEPLOY_ROOT}"
"${GITHUB_WORKSPACE}/runtime-main/node_modules/.bin/wrangler" pages deploy out \
  --project-name "${REPAIR_PREVIEW_PROJECT_NAME}" \
  --branch "${REPAIR_PREVIEW_PROJECT_BRANCH}" \
  --commit-hash "${APPROVED_MAIN_RUNTIME_SHA}" \
  --commit-message "Repair rebound Discord preview runtime ${APPROVED_MAIN_RUNTIME_SHA}" \
  | tee repaired-rebound-discord-preview-deploy.txt

node <<'NODE'
const fs = require("node:fs");
const projectName = process.env.REPAIR_PREVIEW_PROJECT_NAME;
const stableUrl = `https://${projectName}.pages.dev`;
const text = fs.readFileSync("repaired-rebound-discord-preview-deploy.txt", "utf8");
const urls = [...new Set((text.match(/https:\/\/[^\s"'<>]+?\.pages\.dev/g) ?? []).map((url) => url.replace(/[),.;]+$/, "")))];
const immutableUrl = urls.find((url) => url !== stableUrl) ?? "";
if (!immutableUrl) throw new Error("Wrangler did not report a distinct immutable preview URL for the repair deployment.");
const deploymentId = immutableUrl.match(/^https:\/\/([^.]+)\./)?.[1] ?? "unknown";
fs.appendFileSync(process.env.GITHUB_ENV, [
  `REPAIR_IMMUTABLE_PREVIEW_URL=${immutableUrl}`,
  `REPAIR_STABLE_PREVIEW_URL=${stableUrl}`,
  `REPAIR_DEPLOYMENT_ID=${deploymentId}`,
  "",
].join("\n"));
console.log(`Repair preview deployment ID: ${deploymentId}`);
console.log(`Repair immutable preview URL: ${immutableUrl}`);
console.log(`Repair stable preview URL: ${stableUrl}`);
NODE
