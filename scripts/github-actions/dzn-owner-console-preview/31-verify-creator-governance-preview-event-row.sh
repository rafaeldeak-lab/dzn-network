set -euo pipefail

case "${PREVIEW_DB_NAME}" in
  dzn_network_db_owner_console_preview_creator_governance_*) ;;
  *)
    echo "::error::Refusing creator-governance row verification for non-governance preview database name."
    exit 1
    ;;
esac
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID}" ]; then
  echo "::error::Refusing creator-governance row verification because preview D1 id equals production D1 id."
  exit 1
fi

node <<'NODE'
const fs = require("node:fs");
const eventName = process.env.OWNER_CONSOLE_CREATOR_EVENT_NAME ?? "";
const shortSha = process.env.OWNER_CONSOLE_CANDIDATE_SHORT_SHA ?? "";
if (!/^Creator Governance Preview Cup [a-f0-9]{7}$/.test(eventName)) {
  console.error("Creator-governance preview event name is missing or malformed.");
  process.exit(1);
}
if (!/^[a-f0-9]{7}$/.test(shortSha)) {
  console.error("Creator-governance preview short SHA is missing or malformed.");
  process.exit(1);
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
  e.starts_at,
  e.ends_at,
  CASE WHEN e.created_by IS NOT NULL AND e.created_by != '' THEN 1 ELSE 0 END AS created_by_present,
  CASE WHEN EXISTS (SELECT 1 FROM users WHERE users.id = e.created_by) THEN 1 ELSE 0 END AS created_by_user_exists,
  ces.server_id AS hosting_server_id,
  ces.category AS registration_category,
  ces.approved,
  ces.seed,
  ls.competitive_enabled,
  ls.server_category AS host_category,
  CASE WHEN ls.last_event_at IS NOT NULL AND ls.last_event_at != '' THEN 1 ELSE 0 END AS host_last_event_at_set,
  (SELECT COUNT(*) FROM competitive_event_activity activity WHERE activity.event_id = e.id) AS activity_count,
  (SELECT activity.activity_type FROM competitive_event_activity activity WHERE activity.event_id = e.id ORDER BY activity.created_at DESC LIMIT 1) AS activity_type
FROM competitive_events e
LEFT JOIN competitive_event_servers ces ON ces.event_id = e.id
LEFT JOIN linked_servers ls ON ls.id = ces.server_id
WHERE e.name = '${eventName.replaceAll("'", "''")}'
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
const rows = rowsFromWranglerJson("owner-console-creator-event-count.json");
if (rows.length !== 1) {
  console.error(`Expected exactly one preview creator-governance event row, got ${rows.length}.`);
  process.exit(1);
}
const row = rows[0] ?? {};
const expectedName = process.env.OWNER_CONSOLE_CREATOR_EVENT_NAME;
const shortSha = process.env.OWNER_CONSOLE_CANDIDATE_SHORT_SHA;
const expected = {
  name: expectedName,
  slug: `creator-governance-preview-cup-${shortSha}`,
  event_type: "community_cup",
  category: "deathmatch",
  hosting_server_id: "owner-console-creator-host",
  registration_category: "deathmatch",
  status: "registration_open",
  visibility: "public",
  starts_at: "2026-08-01T18:00:00.000Z",
  ends_at: "2026-08-01T20:00:00.000Z",
  approved: 1,
  seed: 1,
  competitive_enabled: 1,
  host_category: "deathmatch",
  host_last_event_at_set: 1,
  activity_count: 1,
  activity_type: "event_created",
  created_by_present: 1,
  created_by_user_exists: 1,
};
for (const [key, value] of Object.entries(expected)) {
  if (row[key] !== value) {
    console.error(`Creator-governance preview event ${key} mismatch.`);
    process.exit(1);
  }
}
const fkRows = rowsFromWranglerJson("owner-console-creator-event-foreign-key-check.json");
if (fkRows.length > 0) {
  console.error("Creator-governance preview event foreign_key_check returned rows.");
  process.exit(1);
}
console.log("Creator-governance preview D1 row verified.");
NODE

{
  echo "## Creator Event Governance Preview Row"
  echo ""
  echo "- Preview event row count: 1"
  echo "- Event type/status/visibility/host: verified"
  echo "- Host registration/activity/foreign keys: verified"
} >> "$GITHUB_STEP_SUMMARY"
