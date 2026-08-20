set -euo pipefail

if [ "${ACTIVATE_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing to deploy production Pages project from activation mode."
  exit 1
fi
if [ "$(git -C runtime-main rev-parse HEAD)" != "${APPROVED_MAIN_RUNTIME_SHA}" ]; then
  echo "::error::Runtime checkout changed before activation deploy."
  exit 1
fi
if [ "${DZN_DISCORD_NOTIFICATIONS_ENABLED}" != "false" ] || [ "${DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED}" != "false" ]; then
  echo "::error::Discord flags must remain false for activation deployment."
  exit 1
fi
if [ -z "${OWNER_CONSOLE_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}" ]; then
  echo "::error::Missing Cloudflare API token for activation deployment."
  exit 1
fi
export CLOUDFLARE_API_TOKEN="${OWNER_CONSOLE_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"

DEPLOY_ROOT="${RUNNER_TEMP}/dzn-discord-preview-deploy"
case "${DEPLOY_ROOT}" in
  "${RUNNER_TEMP}"/*) ;;
  *)
    echo "::error::Deployment root must stay inside RUNNER_TEMP."
    exit 1
    ;;
esac
rm -rf "${DEPLOY_ROOT}"
mkdir -p "${DEPLOY_ROOT}"
cp -R runtime-main/out "${DEPLOY_ROOT}/out"

if find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env | grep -q .; then
  echo "::error::Production or local Wrangler configuration is deploy-visible."
  find "${DEPLOY_ROOT}" -name wrangler.toml -o -name wrangler.json -o -name wrangler.jsonc -o -name .dev.vars -o -name .env
  exit 1
fi
if grep -R -E 'name[[:space:]]*=[[:space:]]*"dzn-network"|database_name[[:space:]]*=[[:space:]]*"dzn_network_db"|dzn_network_db' "${DEPLOY_ROOT}" >/tmp/dzn-preview-production-leak.txt 2>/dev/null; then
  echo "::error::Deployment-visible output contains production project or D1 configuration markers."
  cut -d: -f1 /tmp/dzn-preview-production-leak.txt | sort -u | sed 's#^#blocked file: #'
  exit 1
fi

cd "${DEPLOY_ROOT}"
"${GITHUB_WORKSPACE}/runtime-main/node_modules/.bin/wrangler" pages deploy out \
  --project-name "${ACTIVATE_PREVIEW_PROJECT_NAME}" \
  --branch "${ACTIVATE_PREVIEW_PROJECT_BRANCH}" \
  --commit-hash "${APPROVED_MAIN_RUNTIME_SHA}" \
  --commit-message "Activate rebound Discord preview runtime ${APPROVED_MAIN_RUNTIME_SHA}" \
  | tee rebound-discord-preview-deploy.txt

node <<'NODE'
const fs = require("node:fs");
const projectName = process.env.ACTIVATE_PREVIEW_PROJECT_NAME;
const stableUrl = `https://${projectName}.pages.dev`;
const text = fs.readFileSync("rebound-discord-preview-deploy.txt", "utf8");
const urls = [...new Set((text.match(/https:\/\/[^\s"'<>]+?\.pages\.dev/g) ?? []).map((url) => url.replace(/[),.;]+$/, "")))];
const immutableUrl = urls.find((url) => url !== stableUrl) ?? "";
if (!immutableUrl) {
  throw new Error("Wrangler did not report a distinct immutable preview URL for the activation deployment.");
}
const deploymentId = immutableUrl.match(/^https:\/\/([^.]+)\./)?.[1] ?? "unknown";
fs.appendFileSync(process.env.GITHUB_ENV, [
  `ACTIVATE_IMMUTABLE_PREVIEW_URL=${immutableUrl}`,
  `ACTIVATE_STABLE_PREVIEW_URL=${stableUrl}`,
  `ACTIVATE_DEPLOYMENT_ID=${deploymentId}`,
  "",
].join("\n"));
console.log(`Rebound Discord preview deployment ID: ${deploymentId}`);
console.log(`Rebound Discord preview immutable URL: ${immutableUrl}`);
console.log(`Rebound Discord preview stable URL: ${stableUrl}`);
NODE

{
  echo ""
  echo "## Rebound Discord Preview Deployment"
  echo ""
  echo "- Preview Pages project: ${ACTIVATE_PREVIEW_PROJECT_NAME}"
  echo "- Preview project branch: ${ACTIVATE_PREVIEW_PROJECT_BRANCH}"
  echo "- Runtime commit: ${APPROVED_MAIN_RUNTIME_SHA}"
  echo "- Runtime tree: ${ACTIVATE_RUNTIME_TREE_SHA}"
  echo "- Deployment ID: ${ACTIVATE_DEPLOYMENT_ID:-unknown}"
  echo "- Immutable preview URL: ${ACTIVATE_IMMUTABLE_PREVIEW_URL:-unknown}"
  echo "- Stable preview URL: ${ACTIVATE_STABLE_PREVIEW_URL:-https://${ACTIVATE_PREVIEW_PROJECT_NAME}.pages.dev}"
  echo "- DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED: false"
  echo "- DZN_DISCORD_NOTIFICATIONS_ENABLED: false"
  echo "- Discord messages sent: false"
} >> "$GITHUB_STEP_SUMMARY"
