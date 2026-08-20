set -euo pipefail

case "${PREVIEW_DB_NAME}" in
  *owner_console_preview*) ;;
  *)
    echo "::error::Refusing migration for non-preview owner console database name."
    exit 1
    ;;
esac
if [ "${PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID}" ]; then
  echo "::error::Refusing migration because preview D1 id equals production D1 id."
  exit 1
fi

npx wrangler d1 migrations apply DB --config wrangler.owner-console-preview.toml --remote | tee owner-console-preview-migrations.txt
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "PRAGMA table_info(linked_servers);" > owner-console-linked-columns.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "PRAGMA table_info(server_sync_state);" > owner-console-sync-columns.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "PRAGMA table_info(server_build_stats);" > owner-console-build-stats-columns.json
npx wrangler d1 execute DB --config wrangler.owner-console-preview.toml --remote --json --command "PRAGMA foreign_key_check;" > owner-console-preview-foreign-key-check.json

node <<'NODE'
const fs = require("node:fs");
function rowsFromWranglerJson(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
const linkedColumns = new Set(rowsFromWranglerJson("owner-console-linked-columns.json").map((row) => row.name));
for (const name of ["lifecycle_status", "lifecycle_reason", "owner_action_required", "owner_action_reason", "latest_imported_event_at", "listing_visibility"]) {
  if (!linkedColumns.has(name)) {
    console.error(`linked_servers is missing ${name}.`);
    process.exit(1);
  }
}
const syncColumns = new Set(rowsFromWranglerJson("owner-console-sync-columns.json").map((row) => row.name));
for (const name of ["next_metadata_check_at", "next_player_count_check_at", "next_adm_discovery_at", "next_adm_processing_at", "next_retry_after", "last_skip_reason"]) {
  if (!syncColumns.has(name)) {
    console.error(`server_sync_state is missing ${name}.`);
    process.exit(1);
  }
}
const buildStatsColumns = new Set(rowsFromWranglerJson("owner-console-build-stats-columns.json").map((row) => row.name));
for (const name of ["linked_server_id", "nitrado_service_id", "structures_built", "build_items_placed", "storage_items_placed", "traps_placed", "build_score", "top_builder_name", "top_builder_count", "last_build_at", "updated_at"]) {
  if (!buildStatsColumns.has(name)) {
    console.error(`server_build_stats is missing ${name}.`);
    process.exit(1);
  }
}
const fkRows = rowsFromWranglerJson("owner-console-preview-foreign-key-check.json");
if (fkRows.length > 0) {
  console.error("Preview D1 foreign_key_check returned rows.");
  process.exit(1);
}
console.log("Owner console preview D1 schema verified.");
NODE
