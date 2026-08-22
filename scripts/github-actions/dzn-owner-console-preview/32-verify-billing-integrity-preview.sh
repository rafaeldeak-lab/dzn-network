set -euo pipefail

case "${PREVIEW_DB_NAME}" in
  *owner_console_preview*) ;;
  *)
    echo "::error::Refusing billing verification for non-preview owner console database name."
    exit 1
    ;;
esac
if [ "${PREVIEW_DB_NAME}" = "${PRODUCTION_D1_DATABASE_NAME}" ]; then
  echo "::error::Refusing billing verification for production D1 database name."
  exit 1
fi
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID}" ]; then
  echo "::error::Refusing billing verification because preview D1 id equals production D1 id."
  exit 1
fi

npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "SELECT name FROM d1_migrations ORDER BY id;" > owner-console-billing-migration-ledger.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "SELECT substr(name, 1, 4) AS prefix, COUNT(*) AS count, group_concat(name) AS names FROM d1_migrations WHERE name GLOB '[0-9][0-9][0-9][0-9]_*' GROUP BY prefix HAVING COUNT(*) > 1;" > owner-console-billing-duplicate-migrations.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "PRAGMA table_info(linked_server_allowance_reservations);" > owner-console-billing-reservation-columns.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name IN ('idx_lsar_user_status_expires', 'idx_lsar_linked_server_status', 'idx_lsar_discord_user_status', 'idx_lsar_active_linked_server', 'idx_nitrado_connections_user_linked_server_updated', 'idx_linked_servers_user_service_active', 'idx_linked_servers_active_service_id') ORDER BY name;" > owner-console-billing-indexes.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "PRAGMA foreign_key_check;" > owner-console-billing-foreign-key-check.json

node <<'NODE'
const fs = require("node:fs");

function rowsFromWranglerJson(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const ledger = rowsFromWranglerJson("owner-console-billing-migration-ledger.json")
  .map((row) => String(row.name ?? ""))
  .filter(Boolean);
if (!ledger.includes("0057_event_suggestions_phase_2a.sql")) {
  fail("Preview migration ledger is missing 0057_event_suggestions_phase_2a.sql.");
}
if (!ledger.includes("0058_billing_phase_1_integrity.sql")) {
  fail("Preview migration ledger is missing 0058_billing_phase_1_integrity.sql.");
}
if (ledger.includes("0057_billing_phase_1_integrity.sql")) {
  fail("Preview migration ledger contains stale 0057_billing_phase_1_integrity.sql.");
}
if (ledger.indexOf("0057_event_suggestions_phase_2a.sql") > ledger.indexOf("0058_billing_phase_1_integrity.sql")) {
  fail("Billing integrity migration was applied before event suggestions migration.");
}

const duplicates = rowsFromWranglerJson("owner-console-billing-duplicate-migrations.json");
if (duplicates.length > 0) {
  fail(`Preview migration ledger has duplicate numeric prefixes: ${JSON.stringify(duplicates)}`);
}

const columns = new Set(rowsFromWranglerJson("owner-console-billing-reservation-columns.json").map((row) => row.name));
for (const column of ["id", "user_id", "discord_user_id", "linked_server_id", "purpose", "status", "expires_at", "completed_at", "released_at", "expired_at", "release_reason", "created_at", "updated_at"]) {
  if (!columns.has(column)) fail(`linked_server_allowance_reservations is missing ${column}.`);
}

const indexes = new Set(rowsFromWranglerJson("owner-console-billing-indexes.json").map((row) => row.name));
for (const index of [
  "idx_lsar_user_status_expires",
  "idx_lsar_linked_server_status",
  "idx_lsar_discord_user_status",
  "idx_lsar_active_linked_server",
  "idx_nitrado_connections_user_linked_server_updated",
  "idx_linked_servers_user_service_active",
  "idx_linked_servers_active_service_id",
]) {
  if (!indexes.has(index)) fail(`Preview D1 is missing integrity index ${index}.`);
}

const foreignKeyRows = rowsFromWranglerJson("owner-console-billing-foreign-key-check.json");
if (foreignKeyRows.length > 0) {
  fail("Preview D1 foreign_key_check returned rows after billing integrity migration.");
}

fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
  "## Billing Integrity Preview Verification",
  "",
  "- Migration 0057: event suggestions verified",
  "- Migration 0058: billing integrity verified",
  "- Duplicate numeric migration prefixes: none",
  "- Reservation table and indexes: verified",
  "- Exact Nitrado connection lookup indexes: verified",
  "- Foreign key check: passed",
].join("\n") + "\n");
console.log("Billing integrity preview D1 schema verified.");
NODE
