set -euo pipefail

if [ "${CONFIRM_EXISTING_CREATOR_GOVERNANCE_PREVIEW}" != "VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW" ]; then
  echo "::error::confirm_existing_creator_governance_preview must equal VERIFY_EXISTING_CREATOR_GOVERNANCE_PREVIEW."
  exit 1
fi
if [ "${EXISTING_CREATOR_GOVERNANCE_PREVIEW_PROJECT_NAME}" != "${PREVIEW_PROJECT_NAME}" ]; then
  echo "::error::Existing creator-governance preview project must match the owner-console preview project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" != "${EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME}" ]; then
  echo "::error::Existing creator-governance preview database constant mismatch."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
  echo "::error::Refusing existing creator-governance verification for production D1 name."
  exit 1
fi

node <<'NODE'
const fs = require("node:fs");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.OWNER_CONSOLE_CF_TOKEN;
const previewDbName = process.env.EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME;
const projectName = process.env.EXISTING_CREATOR_GOVERNANCE_PREVIEW_PROJECT_NAME;
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const productionName = process.env.DETECTED_PRODUCTION_D1_DATABASE_NAME || process.env.PRODUCTION_D1_DATABASE_NAME;
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function sanitize(value) {
  let text = String(value ?? "");
  for (const sensitive of [accountId, productionId, token]) {
    if (sensitive) text = text.split(sensitive).join("[redacted]");
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .replace(/(authorization|cookie|session|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}
function fail(message) {
  console.error(sanitize(message));
  process.exit(1);
}
function databaseId(database) {
  return String(database?.uuid ?? database?.id ?? database?.database_id ?? "");
}
async function api(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: false, errors: [{ code: `http_${response.status}`, message: "non_json_response" }] };
  }
  if (!response.ok || parsed?.success === false) {
    const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    fail(`Cloudflare read failed status=${response.status} code=${first?.code ?? "unknown"} message=${first?.message ?? "unknown"}`);
  }
  return parsed.result;
}
function envValue(config, key) {
  const value = config?.env_vars?.[key];
  if (value && typeof value === "object") return String(value.value ?? "");
  return String(value ?? "");
}
function dbBindingId(config) {
  const db = config?.d1_databases?.DB;
  return String(db?.id ?? db?.database_id ?? db ?? "");
}
void (async () => {
  const d1Result = await api("/d1/database?per_page=50&page=1");
  const databases = Array.isArray(d1Result) ? d1Result : d1Result?.databases ?? [];
  const database = databases.find((entry) => String(entry?.name ?? "") === previewDbName);
  if (!database) fail("Exact existing creator-governance preview D1 was not found.");
  const previewId = databaseId(database);
  if (!previewId) fail("Exact existing creator-governance preview D1 id was not available.");
  if (previewDbName === productionName || previewId === productionId) fail("Existing creator-governance preview D1 matches production by name or id.");
  const project = await api(`/pages/projects/${encodeURIComponent(projectName)}`);
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment] ?? {};
    const bindingId = dbBindingId(config);
    if (bindingId !== previewId) fail(`${environment} Pages config DB binding does not resolve to the existing creator-governance preview D1.`);
    if (envValue(config, "DZN_DISCORD_SERVER_ANNOUNCEMENTS_ENABLED") !== "false") fail(`${environment} server announcement flag is not false.`);
    if (envValue(config, "DZN_DISCORD_NOTIFICATIONS_ENABLED") !== "false") fail(`${environment} Discord notifications flag is not false.`);
  }
  fs.writeFileSync("wrangler.owner-console-preview.toml", [
    'name = "dzn-owner-console-preview-existing-verify"',
    'compatibility_date = "2026-05-13"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = ${JSON.stringify(previewDbName)}`,
    `database_id = ${JSON.stringify(previewId)}`,
    "",
  ].join("\n"));
  fs.appendFileSync(process.env.GITHUB_ENV, `PREVIEW_D1_DATABASE_ID=${previewId}\n`);
  console.log(`Existing creator-governance preview D1 resolved: ${previewDbName} id=${maskId(previewId)}`);
  console.log("Existing owner-console preview Pages bindings and Discord flags verified.");
})().catch((error) => fail(error instanceof Error ? error.message : String(error)));
NODE

node <<'NODE'
const fs = require("node:fs");
const eventName = process.env.EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME;
if (eventName !== "Creator Governance Preview Cup 0919c46") {
  console.error("Existing creator-governance preview event constant mismatch.");
  process.exit(1);
}
function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
fs.writeFileSync("owner-console-creator-event-verify.sql", `
SELECT
  e.id,
  e.name,
  e.slug,
  e.event_type,
  e.category,
  e.status,
  e.visibility,
  CASE WHEN e.created_by IS NOT NULL AND e.created_by != '' THEN 1 ELSE 0 END AS created_by_present,
  CASE WHEN EXISTS (SELECT 1 FROM users WHERE users.id = e.created_by) THEN 1 ELSE 0 END AS created_by_user_exists,
  ces.server_id AS hosting_server_id,
  ces.category AS registration_category,
  ces.approved,
  ces.seed,
  ls.competitive_enabled,
  ls.server_category AS host_category,
  (SELECT COUNT(*) FROM competitive_event_activity activity WHERE activity.event_id = e.id) AS activity_count,
  (SELECT activity.activity_type FROM competitive_event_activity activity WHERE activity.event_id = e.id ORDER BY activity.created_at DESC LIMIT 1) AS activity_type
FROM competitive_events e
LEFT JOIN competitive_event_servers ces ON ces.event_id = e.id
LEFT JOIN linked_servers ls ON ls.id = ces.server_id
WHERE e.name = ${sql(eventName)}
ORDER BY e.created_at DESC;
`);
NODE

VERIFY_SQL="$(cat owner-console-creator-event-verify.sql)"
npx wrangler d1 execute DB \
  --config wrangler.owner-console-preview.toml \
  --remote \
  --json \
  --command "${VERIFY_SQL}" \
  > owner-console-creator-event-count.json \
  2> owner-console-creator-event-count.stderr.log
npx wrangler d1 execute DB \
  --config wrangler.owner-console-preview.toml \
  --remote \
  --json \
  --command "PRAGMA foreign_key_check;" \
  > owner-console-creator-event-foreign-key-check.json \
  2> owner-console-creator-event-foreign-key-check.stderr.log

node <<'NODE'
const fs = require("node:fs");
const previewBaseUrl = process.env.PREVIEW_BASE_URL;
function sanitizeLine(value) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted-token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .replace(/(authorization|cookie|session|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 240);
}
function parseWranglerJsonFile(path) {
  const buffer = fs.readFileSync(path);
  const raw = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const trimmed = raw.trimStart();
  const first = trimmed[0] ?? "";
  const jsonStartFound = first === "[" || first === "{";
  if (!jsonStartFound) {
    const firstSafeLine = sanitizeLine(raw.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "");
    console.error(`Malformed Wrangler JSON in ${path}: byteLength=${buffer.length}; jsonStartFound=false; firstSafeLine=${firstSafeLine}`);
    process.exit(1);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstSafeLine = sanitizeLine(raw.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "");
    console.error(`Malformed Wrangler JSON in ${path}: byteLength=${buffer.length}; jsonStartFound=true; firstSafeLine=${firstSafeLine}`);
    process.exit(1);
  }
}
function rowsFromWranglerJson(path) {
  const parsed = parseWranglerJsonFile(path);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}
async function fetchPath(path, expectedStatus) {
  const response = await fetch(`${previewBaseUrl}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": "dzn-existing-creator-governance-preview-verify", "Cache-Control": "no-cache" },
  });
  const text = await response.text().catch(() => "");
  if (response.status !== expectedStatus) {
    console.error(`${path} expected ${expectedStatus}, got ${response.status}; content-type=${response.headers.get("content-type") || "unknown"}; body-length=${text.length}`);
    process.exit(1);
  }
  for (const marker of ["TOKEN_ENCRYPTION_KEY", "SESSION_SECRET", "encrypted_token", "Error 1102", "Worker exceeded resource limits"]) {
    if (text.includes(marker)) {
      console.error(`${path} exposed forbidden marker ${marker}.`);
      process.exit(1);
    }
  }
  return { response, text };
}
void (async () => {
  const owner = await fetchPath("/owner", 302);
  assert((owner.response.headers.get("location") || "").includes("/login"), "/owner did not redirect to login.");
  await fetchPath("/api/owner/overview", 401);
  await fetchPath("/api/owner/servers", 401);
  await fetchPath("/api/owner/audit-log", 401);
  await fetchPath("/api/owner/discord/overview", 401);
  await fetchPath("/", 200);
  await fetchPath("/events", 200);
  await fetchPath("/events/suggest", 200);
  await fetchPath("/api/public/servers", 200);
  await fetchPath("/api/public/home-stats", 200);
  await fetchPath("/api/public/leaderboards", 200);
  await fetchPath("/api/public/server-rail", 200);
  const pulse = await fetchPath("/api/dzn-pulse/config", 200);
  const pulseJson = JSON.parse(pulse.text);
  assert(pulseJson.discordNotificationsEnabled === false || pulseJson.config?.discordNotificationsEnabled === false, "discordNotificationsEnabled was not false.");

  const rows = rowsFromWranglerJson("owner-console-creator-event-count.json");
  assert(rows.length === 1, `Expected exactly one existing preview event row, got ${rows.length}.`);
  const row = rows[0] ?? {};
  const expected = {
    name: process.env.EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME,
    slug: process.env.EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_SLUG,
    event_type: "community_cup",
    category: "deathmatch",
    hosting_server_id: "owner-console-nuketown",
    registration_category: "deathmatch",
    status: "registration_open",
    visibility: "public",
    approved: 1,
    seed: 1,
    competitive_enabled: 1,
    activity_count: 1,
    activity_type: "event_created",
    created_by_present: 1,
    created_by_user_exists: 1,
  };
  for (const [key, value] of Object.entries(expected)) {
    assert(row[key] === value, `Existing creator-governance preview event ${key} mismatch.`);
  }
  const fkRows = rowsFromWranglerJson("owner-console-creator-event-foreign-key-check.json");
  assert(fkRows.length === 0, "Existing creator-governance preview foreign_key_check returned rows.");
  console.log("Existing creator-governance preview verified read-only.");
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE

{
  echo "## Existing Creator Governance Preview Verification"
  echo ""
  echo "- Preview project: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_PROJECT_NAME}"
  echo "- Preview database: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_DB_NAME}"
  echo "- Preview event: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_NAME}"
  echo "- Preview slug: ${EXISTING_CREATOR_GOVERNANCE_PREVIEW_EVENT_SLUG}"
  echo "- D1 create/delete/migration/seed: none"
  echo "- Pages deploy/patch/secrets: none"
  echo "- Application POST: none"
  echo "- Discord message: false"
} >> "$GITHUB_STEP_SUMMARY"
