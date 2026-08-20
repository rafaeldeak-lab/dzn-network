set -euo pipefail

mkdir -p dzn-event-platform-performance-preview
if [ "${CANDIDATE_BRANCH}" != "feature/event-platform-performance-foundation" ]; then
  echo "::error::event-platform-performance-preview mode may only run from feature/event-platform-performance-foundation."
  exit 1
fi
if [ "${CONFIRM_EVENT_PLATFORM_PERFORMANCE_PREVIEW}" != "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_CONFIRMATION}" ]; then
  echo "::error::confirm_event_platform_performance_preview must equal APPROVE_EVENT_PLATFORM_PERFORMANCE_PREVIEW."
  exit 1
fi
if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing event platform performance preview for production Pages project."
  exit 1
fi
if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing event platform performance preview for production D1 database name."
  exit 1
fi
if [ -z "${OWNER_CONSOLE_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}" ]; then
  echo "::error::Missing Cloudflare token for event platform performance preview."
  exit 1
fi
echo "::add-mask::owner-console-preview-owner-token"
echo "::add-mask::owner-console-preview-creator-token"
echo "::add-mask::owner-console-preview-non-owner-token"
echo "::add-mask::dzn_session=owner-console-preview-owner-token"
echo "::add-mask::dzn_session=owner-console-preview-creator-token"
echo "::add-mask::dzn_session=owner-console-preview-non-owner-token"
export CLOUDFLARE_API_TOKEN="${OWNER_CONSOLE_CF_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const projectName = process.env.EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME;
const previewDbName = process.env.EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME;
const productionProjectName = process.env.PRODUCTION_PAGES_PROJECT_NAME;
const productionDbName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
const productionDbId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const branch = process.env.CANDIDATE_BRANCH;
const sha = process.env.CANDIDATE_SHA;
const runId = String(process.env.GITHUB_RUN_ID || "");
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "");
const repository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const previewBaseUrl = process.env.PREVIEW_BASE_URL;

function sanitizeFailureValue(value) {
  return String(value ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[uuid]")
    .replace(/[A-Za-z0-9_\-]{64,}/g, "[redacted]")
    .slice(0, 500);
}
function writeFailureSummary(category, message, details = {}) {
  fs.mkdirSync(artifacts, { recursive: true });
  const safeDetails = {};
  for (const [key, value] of Object.entries(details)) {
    safeDetails[key] = sanitizeFailureValue(value);
  }
  fs.writeFileSync(`${artifacts}/failure-summary.json`, JSON.stringify({
    ok: false,
    category,
    message: sanitizeFailureValue(message),
    details: safeDetails,
    mode: "event-platform-performance-preview",
    branch: process.env.CANDIDATE_BRANCH,
    commit: process.env.CANDIDATE_SHA,
  }, null, 2));
}
function fail(message, details = {}) {
  writeFailureSummary(details.category || "PHASE2A_PREVIEW_VERIFICATION_FAILED", message, details);
  console.error(message);
  process.exit(1);
}
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function unwrap(result) {
  if (!result.ok || result.parsed?.success === false) {
    const first = Array.isArray(result.parsed?.errors) ? result.parsed.errors[0] : null;
    fail(`Cloudflare read failed: status=${result.status}; code=${first?.code ?? "unknown"}; category=${String(first?.message ?? "Cloudflare API error").slice(0, 160)}`);
  }
  return result.parsed?.result;
}
async function cloudflare(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: false, errors: [{ code: "non_json", message: "non-json Cloudflare response" }] };
  }
  return { ok: response.ok, status: response.status, parsed };
}
async function listD1Databases() {
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await cloudflare(`/d1/database?per_page=50&page=${page}`);
    const body = unwrap(result);
    rows.push(...(Array.isArray(body) ? body : []));
    const info = result.parsed?.result_info;
    if (!info || Number(info.page || page) >= Number(info.total_pages || page)) break;
  }
  return rows;
}
function d1BindingId(config) {
  const db = config?.d1_databases?.DB;
  if (typeof db === "string") return db;
  return String(db?.id ?? db?.database_id ?? "");
}
function envValue(config, key) {
  const value = config?.env_vars?.[key];
  return typeof value === "object" && value ? String(value.value ?? "") : String(value ?? "");
}
function productionSignature(project) {
  const configs = project?.deployment_configs || {};
  return JSON.stringify({
    name: project?.name,
    productionBranch: project?.production_branch ?? null,
    productionDb: d1BindingId(configs.production || {}),
    previewDb: d1BindingId(configs.preview || {}),
  });
}
async function activePreviewRunsUsingReusableDb() {
  if (!repository || !githubToken) return [{ id: "unknown", status: "unknown", reason: "github-token-unavailable" }];
  const active = [];
  for (const status of ["queued", "in_progress"]) {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs?status=${status}&per_page=100`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return [{ id: "unknown", status, reason: "github-actions-inventory-unavailable" }];
    const payload = await response.json();
    for (const run of payload.workflow_runs || []) {
      const id = String(run.id || "");
      if (id === runId) continue;
      if (run.name === "DZN Owner Console Preview" && ["queued", "in_progress"].includes(String(run.status))) {
        active.push({ id, status: run.status, branch: run.head_branch || "unknown" });
      }
    }
  }
  return active;
}

void (async () => {
  if (projectName !== "dzn-network-owner-console-preview") fail("Event platform performance preview project constant mismatch.");
  if (previewDbName !== "dzn_network_db_owner_console_preview_creator_governance_0919c46") fail("Event platform performance preview DB constant mismatch.");
  if (projectName === productionProjectName) fail("Production Pages project selected for Phase 2A preview.");
  if (previewDbName === productionDbName) fail("Production D1 name selected for Phase 2A preview.");

  const databases = await listD1Databases();
  const previewDb = databases.find((db) => db.name === previewDbName);
  const productionDb = databases.find((db) => db.name === productionDbName) || { uuid: productionDbId, id: productionDbId, name: productionDbName };
  const previewId = String(previewDb?.uuid ?? previewDb?.id ?? "");
  const detectedProductionId = String(productionDb?.uuid ?? productionDb?.id ?? productionDbId ?? "");
  if (!previewDb || !previewId) fail("Fixed reusable Phase 2A preview D1 does not exist.");
  if (previewId === detectedProductionId || previewId === productionDbId) fail("Phase 2A preview D1 id equals production D1 id.");
  console.log(`::add-mask::${previewId}`);

  const project = unwrap(await cloudflare(`/pages/projects/${encodeURIComponent(projectName)}`));
  const productionProject = unwrap(await cloudflare(`/pages/projects/${encodeURIComponent(productionProjectName)}`));
  if (project?.name !== projectName) fail("Resolved Pages project name mismatch.");
  if (project?.name === productionProjectName) fail("Resolved Phase 2A preview project is production.");
  const projectBranch = String(project?.production_branch ?? "");
  if (!projectBranch) fail("Owner console preview project production_branch is not configured.");
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    if (d1BindingId(config) !== previewId) fail(`${environment} preview Pages config DB binding does not point to the fixed reusable preview D1.`);
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") fail(`${environment} DZN_DISCORD_NOTIFICATIONS_ENABLED must remain false.`);
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") fail(`${environment} DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED must remain false.`);
  }
  const activeRuns = await activePreviewRunsUsingReusableDb();
  if (activeRuns.length > 0) fail(`Another active owner-console preview workflow may be mutating the reusable preview D1: ${activeRuns.map((run) => run.id).join(", ")}`);
  if (!/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) {
    fail("Phase 2A run-scoped fixture key requires positive decimal GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT.", {
      category: "PHASE2A_RUN_SCOPED_FIXTURE_COLLISION",
    });
  }
  const phase2aRunKey = `${runId}-${runAttempt}`;
  const phase2aConversionTargetId = `phase2a-preview-conversion-${phase2aRunKey}`;
  const phase2aConversionEventId = `suggestion-draft-${phase2aConversionTargetId}`;
  if (!/^[A-Za-z0-9-]+$/.test(phase2aConversionTargetId) || phase2aConversionTargetId.length >= 72 || phase2aConversionEventId.length >= 110) {
    fail("Phase 2A run-scoped conversion fixture identity is malformed.", {
      category: "PHASE2A_RUN_SCOPED_FIXTURE_COLLISION",
    });
  }

  const wranglerToml = [
    'name = "dzn-event-platform-performance-preview"',
    'compatibility_date = "2026-05-13"',
    'pages_build_output_dir = "out"',
    "",
    "[vars]",
    'DZN_PULSE_ENABLED = "true"',
    'DZN_DISCORD_NOTIFICATIONS_ENABLED = "false"',
    'DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED = "false"',
    `DZN_APP_URL = ${JSON.stringify(previewBaseUrl)}`,
    `NEXT_PUBLIC_APP_URL = ${JSON.stringify(previewBaseUrl)}`,
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = ${JSON.stringify(previewDbName)}`,
    `database_id = ${JSON.stringify(previewId)}`,
    "",
  ].join("\n");
  fs.writeFileSync("wrangler.event-platform-performance-preview.toml", wranglerToml);
  fs.appendFileSync(process.env.GITHUB_ENV, [
    `PREVIEW_D1_DATABASE_ID=${previewId}`,
    `PHASE2A_PREVIEW_D1_DATABASE_ID=${previewId}`,
    `PHASE2A_PRODUCTION_D1_DATABASE_ID=${detectedProductionId}`,
    `PHASE2A_PREVIEW_PROJECT_BRANCH=${projectBranch}`,
    `PHASE2A_PRODUCTION_PROJECT_SIGNATURE=${Buffer.from(productionSignature(productionProject)).toString("base64")}`,
    `OWNER_CONSOLE_OWNER_COOKIE=dzn_session=owner-console-preview-owner-token`,
    `OWNER_CONSOLE_CREATOR_COOKIE=dzn_session=owner-console-preview-creator-token`,
    `OWNER_CONSOLE_NON_OWNER_COOKIE=dzn_session=owner-console-preview-non-owner-token`,
    `PHASE2A_API_MEMBER_USER_ID=owner-console-non-owner-user`,
    `PHASE2A_API_MEMBER_COOKIE=dzn_session=owner-console-preview-non-owner-token`,
    `PHASE2A_RUN_KEY=${phase2aRunKey}`,
    `PHASE2A_CONVERSION_TARGET_ID=${phase2aConversionTargetId}`,
    `PHASE2A_CONVERSION_EVENT_ID=${phase2aConversionEventId}`,
    `PHASE2A_CREATOR_HOST_ID=phase2a-preview-creator-host`,
    `PHASE2A_FOREIGN_HOST_ID=phase2a-preview-foreign-host`,
    "",
  ].join("\n"));
  fs.writeFileSync("dzn-event-platform-performance-preview/guard.json", JSON.stringify({
    mode: "event-platform-performance-preview",
    branch,
    sha,
    project: projectName,
    previewDatabase: previewDbName,
    previewDatabaseIdMask: maskId(previewId),
    productionProject: productionProjectName,
    productionDatabase: productionDbName,
    productionDatabaseIdMask: maskId(detectedProductionId),
    discordNotificationsEnabled: false,
    discordServerAnnouncementsEnabled: false,
    activeMutatingWorkflowRuns: activeRuns.length,
    d1CreateDeletePathEnabled: false,
    runScopedConversionTarget: phase2aConversionTargetId,
  }, null, 2));
  console.log(`Phase 2A preview preflight passed: project=${projectName}; db=${previewDbName}; id=${maskId(previewId)}; branch=${projectBranch}`);
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE

{
  echo "## Event Platform Performance Preview Preflight"
  echo ""
  echo "- Mode: event-platform-performance-preview"
  echo "- Preview project: ${EVENT_PLATFORM_PERFORMANCE_PREVIEW_PROJECT_NAME}"
  echo "- Preview database: ${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}"
  echo "- D1 create/delete: none"
  echo "- Confirmation accepted: true"
} >> "$GITHUB_STEP_SUMMARY"
