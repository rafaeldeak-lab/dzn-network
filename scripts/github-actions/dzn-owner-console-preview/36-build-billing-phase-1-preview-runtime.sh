set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::36-build-billing-phase-1-preview-runtime.sh may only run in billing-phase-1-preview mode."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "dzn-network" ]; then
  echo "::error::Refusing Billing runtime build for a non-dedicated or production Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing Billing runtime build for production D1 database name."
  exit 1
fi
if [ "${DZN_DISCORD_NOTIFICATIONS_ENABLED}" != "false" ] || [ "${DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED}" != "false" ]; then
  echo "::error::Billing preview runtime build requires Discord notification flags to remain false."
  exit 1
fi
if [ "${MOCK_AUTH}" != "true" ] || [ "${MOCK_NITRADO}" != "true" ] || [ "${DZN_PULSE_ENABLED}" != "true" ]; then
  echo "::error::Billing preview runtime build requires MOCK_AUTH=true, MOCK_NITRADO=true, and DZN_PULSE_ENABLED=true."
  exit 1
fi

BILLING_ARTIFACT_DIR="${BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR:-dzn-billing-phase-1-preview}"
mkdir -p "${BILLING_ARTIFACT_DIR}"

npm run test:billing-integrity
npm run test:github-workflows
npx tsc --noEmit --pretty false
npm run lint
npm run build

rm -rf .pages-functions
mkdir -p .pages-functions

npx wrangler pages functions build functions \
  --outdir .pages-functions \
  --build-output-directory out \
  --output-routes-path out/_routes.json \
  --minify

test -s .pages-functions/index.js
cp .pages-functions/index.js out/_worker.js

test -s out/_worker.js
test -s out/_routes.json
cmp -s .pages-functions/index.js out/_worker.js

node <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");
const artifact = process.env.BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR || "dzn-billing-phase-1-preview";
const routes = JSON.parse(fs.readFileSync("out/_routes.json", "utf8"));
const include = Array.isArray(routes.include) ? routes.include : [];
const exclude = Array.isArray(routes.exclude) ? routes.exclude : [];
const requiredApiRoutes = [
  "/api/nitrado/services",
  "/api/nitrado/validate-token",
  "/api/nitrado/test-adm-path",
  "/api/onboarding/save",
  "/api/onboarding/test",
  "/api/billing/status",
  "/api/dzn-pulse/config",
];
function coversRoute(route) {
  if (include.includes(route) || include.includes("/api/*")) return true;
  return include.some((entry) => entry.endsWith("/*") && route.startsWith(entry.slice(0, -1)));
}
const missingApiRoutes = requiredApiRoutes.filter((route) => !coversRoute(route));
if (missingApiRoutes.length > 0) {
  throw new Error(`out/_routes.json missing Billing API route coverage: ${missingApiRoutes.join(", ")}`);
}
function hasStaticPage(route) {
  const trimmed = route.replace(/^\//, "");
  return fs.existsSync(`out/${trimmed}.html`) || fs.existsSync(`out/${trimmed}/index.html`);
}
function hasPageRouting(route) {
  return hasStaticPage(route) || include.includes(route) || include.includes(`${route}/*`) || include.includes("/*");
}
const requiredPages = ["/setup", "/dashboard", "/owner"];
const missingPages = requiredPages.filter((route) => !hasPageRouting(route));
if (missingPages.length > 0) {
  throw new Error(`out route coverage missing relevant Billing preview pages: ${missingPages.join(", ")}`);
}
for (const route of ["/api/*", ...requiredApiRoutes, ...requiredPages]) {
  if (exclude.includes(route)) {
    throw new Error(`out/_routes.json excludes required Billing preview route: ${route}`);
  }
}
const worker = fs.readFileSync("out/_worker.js");
const functionsWorker = fs.readFileSync(".pages-functions/index.js");
const workerHash = crypto.createHash("sha256").update(worker).digest("hex");
const functionsWorkerHash = crypto.createHash("sha256").update(functionsWorker).digest("hex");
if (workerHash !== functionsWorkerHash) {
  throw new Error("out/_worker.js does not match the built Pages Functions worker.");
}
fs.writeFileSync(`${artifact}/endpoint-status-summary.json`, JSON.stringify({
  ok: true,
  stage: "runtime-build",
  workerExists: true,
  workerByteSize: worker.length,
  workerShaPrefix: workerHash.slice(0, 12),
  apiWildcardMakesAllApiFunctionsUseWorker: include.includes("/api/*"),
  requiredApiRoutesCovered: requiredApiRoutes,
  requiredPagesCovered: requiredPages,
  includeCount: include.length,
  excludeCount: exclude.length,
}, null, 2));
console.log(`Billing Pages Functions worker verified: workerByteSize=${worker.length}; workerShaPrefix=${workerHash.slice(0, 12)}; includeCount=${include.length}; excludeCount=${exclude.length}`);
NODE
