set -euo pipefail

if [ "${MODE}" != "billing-phase-1-preview" ]; then
  echo "::error::33-verify-billing-phase-1-preview-schema.sh may only run in billing-phase-1-preview mode."
  exit 1
fi
if [ "${PREVIEW_PROJECT_NAME}" != "${BILLING_PHASE_1_PREVIEW_PROJECT_NAME}" ] || [ "${PREVIEW_PROJECT_NAME}" = "${PRODUCTION_PAGES_PROJECT_NAME}" ]; then
  echo "::error::Refusing Billing schema verification for a non-dedicated or production Pages project."
  exit 1
fi
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ] || [ "${PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-}" ]; then
  echo "::error::Refusing Billing schema verification for production D1 database name."
  exit 1
fi
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Refusing Billing schema verification because preview D1 id equals production D1 id."
  exit 1
fi
if [ -z "${PREVIEW_D1_DATABASE_ID:-}" ]; then
  echo "::error::Missing PREVIEW_D1_DATABASE_ID for Billing schema verification."
  exit 1
fi

BILLING_ARTIFACT_DIR="${BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR:-dzn-billing-phase-1-preview}"
mkdir -p "${BILLING_ARTIFACT_DIR}"

run_d1_read() {
  local label="$1"
  local command="$2"
  local output="$3"
  if [[ "${command}" =~ (^|[[:space:]])(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|PRAGMA[[:space:]]+writable_schema)([[:space:]]|$) ]]; then
    echo "::error::Billing schema verification query ${label} is not read-only."
    exit 1
  fi
  npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "${command}" > "${output}"
}

run_d1_read "migration-ledger-exists" "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations';" "billing-schema-ledger-exists.json"
run_d1_read "migration-ledger" "SELECT id, name FROM d1_migrations ORDER BY id;" "billing-schema-migrations.json"
run_d1_read "reservation-columns" "PRAGMA table_info(linked_server_allowance_reservations);" "billing-schema-reservation-columns.json"
run_d1_read "reservation-indexes" "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'linked_server_allowance_reservations' ORDER BY name;" "billing-schema-reservation-indexes.json"
run_d1_read "exact-linked-server-lookup-tables" "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('linked_servers','discord_guilds','server_log_config','onboarding_checks') ORDER BY name;" "billing-schema-exact-lookup-tables.json"
run_d1_read "linked-server-columns" "PRAGMA table_info(linked_servers);" "billing-schema-linked-server-columns.json"
run_d1_read "linked-server-merge-index" "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_linked_servers_merged_into_server_id';" "billing-schema-linked-server-merge-index.json"
run_d1_read "discord-guild-columns" "PRAGMA table_info(discord_guilds);" "billing-schema-discord-guild-columns.json"
run_d1_read "server-log-config-columns" "PRAGMA table_info(server_log_config);" "billing-schema-server-log-config-columns.json"
run_d1_read "server-log-config-index" "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_server_log_config_linked_server_id';" "billing-schema-server-log-config-index.json"
run_d1_read "onboarding-checks-columns" "PRAGMA table_info(onboarding_checks);" "billing-schema-onboarding-checks-columns.json"
run_d1_read "nitrado-connection-columns" "PRAGMA table_info(nitrado_connections);" "billing-schema-nitrado-connection-columns.json"
run_d1_read "active-service-unique-index" "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_linked_servers_active_service_id';" "billing-schema-active-service-index.json"
run_d1_read "foreign-key-check" "PRAGMA foreign_key_check;" "billing-schema-foreign-key-check.json"

node <<'NODE'
const fs = require("node:fs");
const artifact = process.env.BILLING_PHASE_1_PREVIEW_ARTIFACT_DIR || "dzn-billing-phase-1-preview";
const productionId = process.env.DETECTED_PRODUCTION_D1_DATABASE_ID || "";
const previewId = process.env.PREVIEW_D1_DATABASE_ID || "";
const previewIdMask = maskId(previewId);
const exactLinkedServerLookupProjection = [
  "linked_servers.id AS id",
  "linked_servers.user_id AS user_id",
  "linked_servers.guild_id AS guild_id",
  "linked_servers.discord_guild_id AS discord_guild_id",
  "linked_servers.nitrado_service_id AS nitrado_service_id",
  "linked_servers.nitrado_service_name AS nitrado_service_name",
  "linked_servers.server_name AS server_name",
  "linked_servers.server_type AS server_type",
  "linked_servers.server_category AS server_category",
  "linked_servers.tags_json AS tags_json",
  "linked_servers.region AS region",
  "linked_servers.game AS game",
  "linked_servers.platform AS platform",
  "linked_servers.ip_address AS ip_address",
  "linked_servers.player_slots AS player_slots",
  "linked_servers.status AS status",
  "linked_servers.public_slug AS public_slug",
  "linked_servers.listing_visibility AS listing_visibility",
  "linked_servers.lifecycle_status AS lifecycle_status",
  "linked_servers.merged_into_server_id AS merged_into_server_id",
  "linked_servers.created_at AS created_at",
  "linked_servers.updated_at AS updated_at",
  "discord_guilds.name AS lookup_guild_name",
  "discord_guilds.icon_url AS lookup_guild_icon_url",
  "server_log_config.adm_path AS lookup_private_adm_path",
  "onboarding_checks.adm_logs_found AS lookup_adm_logs_found",
  "onboarding_checks.last_tested_at AS lookup_adm_last_checked_at",
];

function fail(code, message, details = {}) {
  const safeDetails = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, sanitize(value)]));
  const payload = {
    ok: false,
    code,
    message: sanitize(message),
    details: safeDetails,
    branch: process.env.CANDIDATE_BRANCH,
    candidateSha: process.env.CANDIDATE_SHA,
    projectName: process.env.PREVIEW_PROJECT_NAME,
    d1Name: process.env.PREVIEW_DB_NAME,
    d1Id: previewIdMask,
  };
  fs.writeFileSync(`${artifact}/schema-summary.json`, JSON.stringify(payload, null, 2));
  console.error(`${code}: ${message}`);
  process.exit(1);
}
function sanitize(value) {
  return String(value ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted-token]")
    .slice(0, 500);
}
function maskId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : "unavailable";
}
function projectionOutputName(expression) {
  const alias = expression.match(/\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i)?.[1];
  return alias || expression.trim().split(".").pop();
}
function duplicateNames(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}
function rowsFromWranglerJson(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim();
  const start = raw.search(/[\[{]/);
  if (start < 0) fail("BILLING_SCHEMA_WRANGLER_JSON_MALFORMED", `Missing JSON output for ${path}.`);
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    fail("BILLING_SCHEMA_WRANGLER_JSON_MALFORMED", `Malformed JSON output for ${path}.`);
  }
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
function requireColumns(table, rows, required) {
  const names = new Set(rows.map((row) => String(row.name || "")));
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) fail("BILLING_SCHEMA_REQUIRED_COLUMNS_MISSING", `${table} missing required columns.`, { table, missing: missing.join(",") });
  return [...names].sort();
}

if (!previewId || previewId === productionId) {
  fail("BILLING_SCHEMA_PREVIEW_D1_ID_UNSAFE", "Preview D1 ID is missing or equals production D1 ID.");
}

const ledgerExists = rowsFromWranglerJson("billing-schema-ledger-exists.json");
if (ledgerExists.length !== 1 || ledgerExists[0]?.name !== "d1_migrations") {
  fail("BILLING_SCHEMA_MIGRATION_LEDGER_MISSING", "D1 migration ledger table does not exist.");
}

const migrations = rowsFromWranglerJson("billing-schema-migrations.json").map((row, index) => ({
  id: Number(row.id ?? index),
  name: String(row.name ?? ""),
}));
const expectedThrough0059 = fs.readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0, 4)) <= 59)
  .sort();
const migrationNames = migrations.map((row) => row.name);
const missingMigrations = expectedThrough0059.filter((name) => !migrationNames.includes(name));
if (missingMigrations.length > 0) {
  fail("BILLING_SCHEMA_MIGRATIONS_MISSING_THROUGH_0059", "Not all migrations through 0059 are applied.", {
    missingCount: missingMigrations.length,
    firstMissing: missingMigrations[0],
  });
}
const migration0057 = migrations.filter((row) => row.name.startsWith("0057_"));
const migration0058 = migrations.filter((row) => row.name.startsWith("0058_"));
const migration0059 = migrations.filter((row) => row.name.startsWith("0059_"));
if (migration0057.length !== 1 || migration0057[0].name !== "0057_event_suggestions_phase_2a.sql") {
  fail("BILLING_SCHEMA_0057_LEDGER_INVALID", "Migration 0057 ledger entry is missing or incorrect.");
}
if (migration0058.length !== 1 || migration0058[0].name !== "0058_billing_phase_1_integrity.sql") {
  fail("BILLING_SCHEMA_0058_LEDGER_INVALID", "Migration 0058 ledger entry is missing or incorrect.");
}
if (migration0059.length !== 1 || migration0059[0].name !== "0059_linked_server_merge_state.sql") {
  fail("BILLING_SCHEMA_0059_LEDGER_INVALID", "Migration 0059 ledger entry is missing or incorrect.");
}
if (migrationNames.indexOf("0057_event_suggestions_phase_2a.sql") >= migrationNames.indexOf("0058_billing_phase_1_integrity.sql")) {
  fail("BILLING_SCHEMA_MIGRATION_ORDER_INVALID", "Migration 0057 must precede 0058.");
}
if (migrationNames.indexOf("0058_billing_phase_1_integrity.sql") >= migrationNames.indexOf("0059_linked_server_merge_state.sql")) {
  fail("BILLING_SCHEMA_MIGRATION_ORDER_INVALID", "Migration 0058 must precede 0059.");
}

const reservationColumns = requireColumns("linked_server_allowance_reservations", rowsFromWranglerJson("billing-schema-reservation-columns.json"), [
  "id",
  "user_id",
  "discord_user_id",
  "linked_server_id",
  "purpose",
  "status",
  "expires_at",
  "completed_at",
  "released_at",
  "expired_at",
  "release_reason",
  "created_at",
  "updated_at",
]);
const reservationIndexes = rowsFromWranglerJson("billing-schema-reservation-indexes.json");
const reservationIndexNames = new Set(reservationIndexes.map((row) => String(row.name || "")));
for (const indexName of [
  "idx_lsar_user_status_expires",
  "idx_lsar_linked_server_status",
  "idx_lsar_discord_user_status",
  "idx_lsar_active_linked_server",
]) {
  if (!reservationIndexNames.has(indexName)) {
    fail("BILLING_SCHEMA_RESERVATION_INDEX_MISSING", "Reservation index missing.", { indexName });
  }
}
const activeReservationIndex = reservationIndexes.find((row) => row.name === "idx_lsar_active_linked_server");
if (!/UNIQUE/i.test(String(activeReservationIndex?.sql || "")) || !/status\s*=\s*'active'/i.test(String(activeReservationIndex?.sql || ""))) {
  fail("BILLING_SCHEMA_ACTIVE_RESERVATION_INDEX_INVALID", "Active reservation uniqueness index is not protected.");
}

const exactLookupTables = rowsFromWranglerJson("billing-schema-exact-lookup-tables.json");
const exactLookupTableNames = new Set(exactLookupTables.map((row) => String(row.name || "")));
for (const tableName of ["linked_servers", "discord_guilds", "server_log_config", "onboarding_checks"]) {
  if (!exactLookupTableNames.has(tableName)) {
    fail("BILLING_SCHEMA_EXACT_LOOKUP_TABLE_MISSING", "Exact linked-server lookup table missing.", { tableName });
  }
}
const linkedServerColumns = requireColumns("linked_servers", rowsFromWranglerJson("billing-schema-linked-server-columns.json"), [
  "id",
  "user_id",
  "guild_id",
  "discord_guild_id",
  "nitrado_service_id",
  "nitrado_service_name",
  "server_name",
  "server_type",
  "server_category",
  "status",
  "merged_into_server_id",
  "merged_at",
  "lifecycle_status",
  "lifecycle_reason",
  "lifecycle_updated_at",
  "owner_action_required",
  "owner_action_reason",
  "latest_imported_event_at",
  "listing_visibility",
]);
const exactProjectionOutputNames = exactLinkedServerLookupProjection.map(projectionOutputName);
const exactProjectionColumnCount = exactLinkedServerLookupProjection.length;
const exactProjectionUniqueOutputNames = duplicateNames(exactProjectionOutputNames).length === 0;
const exactProjectionWithinLimit = exactProjectionColumnCount < 90;
if (!exactProjectionWithinLimit || !exactProjectionUniqueOutputNames) {
  fail("BILLING_SCHEMA_EXACT_LOOKUP_PROJECTION_UNSAFE", "Exact linked-server lookup projection is not safely bounded.", {
    exactProjectionColumnCount,
    uniqueOutputNames: exactProjectionUniqueOutputNames,
  });
}
const linkedServerMergeIndexes = rowsFromWranglerJson("billing-schema-linked-server-merge-index.json");
if (linkedServerMergeIndexes.length !== 1) {
  fail("BILLING_SCHEMA_LINKED_SERVER_MERGE_INDEX_MISSING", "Linked-server merge-target lookup index is missing.");
}
const linkedServerMergeIndexSql = String(linkedServerMergeIndexes[0].sql || "");
if (!/linked_servers/i.test(linkedServerMergeIndexSql) || !/merged_into_server_id/i.test(linkedServerMergeIndexSql)) {
  fail("BILLING_SCHEMA_LINKED_SERVER_MERGE_INDEX_INVALID", "Linked-server merge-target lookup index is not valid.");
}
const discordGuildColumns = requireColumns("discord_guilds", rowsFromWranglerJson("billing-schema-discord-guild-columns.json"), [
  "id",
  "name",
  "icon_url",
]);
const serverLogConfigColumns = requireColumns("server_log_config", rowsFromWranglerJson("billing-schema-server-log-config-columns.json"), [
  "linked_server_id",
  "adm_path",
]);
const onboardingCheckColumns = requireColumns("onboarding_checks", rowsFromWranglerJson("billing-schema-onboarding-checks-columns.json"), [
  "linked_server_id",
  "adm_logs_found",
  "last_tested_at",
]);
const serverLogConfigIndexes = rowsFromWranglerJson("billing-schema-server-log-config-index.json");
if (serverLogConfigIndexes.length !== 1) {
  fail("BILLING_SCHEMA_EXACT_LOOKUP_SERVER_LOG_CONFIG_INDEX_MISSING", "Exact linked-server lookup server_log_config index is missing.");
}
const serverLogConfigIndexSql = String(serverLogConfigIndexes[0].sql || "");
if (!/server_log_config/i.test(serverLogConfigIndexSql) || !/linked_server_id/i.test(serverLogConfigIndexSql)) {
  fail("BILLING_SCHEMA_EXACT_LOOKUP_SERVER_LOG_CONFIG_INDEX_INVALID", "Exact linked-server lookup server_log_config index is not valid.");
}
const nitradoColumns = requireColumns("nitrado_connections", rowsFromWranglerJson("billing-schema-nitrado-connection-columns.json"), [
  "id",
  "user_id",
  "linked_server_id",
  "encrypted_token",
  "token_iv",
  "token_auth_tag",
]);
const activeServiceIndexes = rowsFromWranglerJson("billing-schema-active-service-index.json");
if (activeServiceIndexes.length !== 1) {
  fail("BILLING_SCHEMA_ACTIVE_SERVICE_UNIQUE_INDEX_MISSING", "Active Nitrado-service uniqueness protection is missing.");
}
const activeServiceSql = String(activeServiceIndexes[0].sql || "");
if (!/UNIQUE/i.test(activeServiceSql) || !/nitrado_service_id/i.test(activeServiceSql) || !/merged/i.test(activeServiceSql) || !/deleted/i.test(activeServiceSql)) {
  fail("BILLING_SCHEMA_ACTIVE_SERVICE_UNIQUE_INDEX_INVALID", "Active Nitrado-service uniqueness index is not protective enough.");
}

const foreignKeyRows = rowsFromWranglerJson("billing-schema-foreign-key-check.json");
if (foreignKeyRows.length > 0) {
  fail("BILLING_SCHEMA_FOREIGN_KEY_CHECK_FAILED", "PRAGMA foreign_key_check returned rows.", { count: foreignKeyRows.length });
}

fs.writeFileSync(`${artifact}/migration-summary.json`, JSON.stringify({
  ok: true,
  migrationLedgerExists: true,
  appliedThrough: "0059",
  appliedMigrationCountThrough0059: expectedThrough0059.length,
  migration0057: "0057_event_suggestions_phase_2a.sql",
  migration0058: "0058_billing_phase_1_integrity.sql",
  migration0059: "0059_linked_server_merge_state.sql",
  migration0057Precedes0058: true,
  migration0058Precedes0059: true,
}, null, 2));
fs.writeFileSync(`${artifact}/schema-summary.json`, JSON.stringify({
  ok: true,
  projectName: process.env.PREVIEW_PROJECT_NAME,
  d1Name: process.env.PREVIEW_DB_NAME,
  d1Id: previewIdMask,
  productionD1IdDifferent: true,
  reservationTableExists: true,
  reservationColumnsPresent: reservationColumns,
  reservationIndexesPresent: [...reservationIndexNames].sort(),
  linkedServerMergeStateColumnsPresent: linkedServerColumns.filter((name) => ["merged_into_server_id", "merged_at"].includes(name)),
  linkedServerMergeStateIndexesPresent: linkedServerMergeIndexes.map((row) => String(row.name || "")).sort(),
  linkedServerMergeLifecycleColumnsPresent: linkedServerColumns.filter((name) => /merged|lifecycle|owner_action|latest_imported|listing_visibility/.test(name)),
  exactLinkedServerLookup: {
    tablesPresent: true,
    columnsPresent: true,
    indexesPresent: true,
    migrationBacked: true,
    linkedServerTableColumnCount: linkedServerColumns.length,
    exactProjectionColumnCount,
    d1ColumnLimit: 100,
    projectionWithinLimit: exactProjectionWithinLimit,
    uniqueOutputNames: exactProjectionUniqueOutputNames,
  },
  exactLinkedServerLookupTablesPresent: [...exactLookupTableNames].sort(),
  exactLinkedServerLookupColumnsPresent: {
    linked_servers: linkedServerColumns.filter((name) => ["id", "user_id", "guild_id", "discord_guild_id", "nitrado_service_id", "status", "merged_into_server_id"].includes(name)),
    discord_guilds: discordGuildColumns,
    server_log_config: serverLogConfigColumns,
    onboarding_checks: onboardingCheckColumns,
  },
  exactLinkedServerLookupIndexesPresent: [
    ...linkedServerMergeIndexes.map((row) => String(row.name || "")),
    ...serverLogConfigIndexes.map((row) => String(row.name || "")),
  ].sort(),
  nitradoConnectionLinkedServerIdPresent: nitradoColumns.includes("linked_server_id"),
  nitradoConnectionCredentialColumnsRedacted: true,
  activeNitradoServiceUniquenessProtection: "idx_linked_servers_active_service_id",
  foreignKeyCheckRows: 0,
}, null, 2));
console.log(`Billing schema verification passed for ${process.env.PREVIEW_DB_NAME}; preview D1 id=${previewIdMask}`);
NODE
