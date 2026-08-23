set -euo pipefail

if [ "${EVENT_PLATFORM_PERFORMANCE_PREVIEW_DB_NAME}" = "${DETECTED_PRODUCTION_D1_DATABASE_NAME:-${PRODUCTION_D1_DATABASE_NAME}}" ]; then
  echo "::error::Refusing 0057 migration against production D1 name."
  exit 1
fi
if [ "${PHASE2A_PREVIEW_D1_DATABASE_ID}" = "${DETECTED_PRODUCTION_D1_DATABASE_ID:-}" ]; then
  echo "::error::Refusing 0057 migration because preview D1 id equals production D1 id."
  exit 1
fi
test -f migrations/0057_event_suggestions_phase_2a.sql

npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --json \
  --command "SELECT name FROM d1_migrations ORDER BY id;" \
  > dzn-event-platform-performance-preview/migrations-before.json \
  2> dzn-event-platform-performance-preview/migrations-before.stderr.log
npx wrangler d1 execute DB \
  --config wrangler.event-platform-performance-preview.toml \
  --remote \
  --json \
  --command "SELECT type, name FROM sqlite_master WHERE name LIKE 'event_suggestion%' OR name LIKE 'idx_event_suggestion%' ORDER BY name;" \
  > dzn-event-platform-performance-preview/schema-before-0057.json \
  2> dzn-event-platform-performance-preview/schema-before-0057.stderr.log

node <<'NODE'
const fs = require("node:fs");
function fail(message) {
  console.error(message);
  process.exit(1);
}
function parseWranglerJson(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").trimStart();
  if (!raw || !["[", "{"].includes(raw[0])) fail(`Malformed Wrangler JSON in ${path}: byteLength=${Buffer.byteLength(raw)}; jsonStartFound=false`);
  try {
    return JSON.parse(raw);
  } catch {
    fail(`Malformed Wrangler JSON in ${path}: byteLength=${Buffer.byteLength(raw)}; jsonStartFound=true`);
  }
}
function rows(path) {
  const parsed = parseWranglerJson(path);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
const migrations = rows("dzn-event-platform-performance-preview/migrations-before.json").map((row) => String(row.name || "")).filter(Boolean);
const objects = rows("dzn-event-platform-performance-preview/schema-before-0057.json");
const has0057 = migrations.includes("0057_event_suggestions_phase_2a.sql");
if (!has0057 && objects.length > 0) {
  fail("Migration 0057 is absent but event suggestion schema objects already exist. BLOCKED.");
}
fs.writeFileSync("dzn-event-platform-performance-preview/phase2a-0057-already-applied.txt", has0057 ? "yes" : "no");
fs.writeFileSync("dzn-event-platform-performance-preview/migration-summary.json", JSON.stringify({
  migration0057AlreadyApplied: has0057,
  appliedMigrationCount: migrations.length,
  eventSuggestionObjectsBefore: objects.length,
}, null, 2));
NODE

if [ "$(cat dzn-event-platform-performance-preview/phase2a-0057-already-applied.txt)" = "no" ]; then
  PHASE2A_MIGRATION_ROOT="${RUNNER_TEMP}/dzn-phase2a-0057-only"
  PHASE2A_MIGRATION_DIR="${PHASE2A_MIGRATION_ROOT}/migrations"
  rm -rf "${PHASE2A_MIGRATION_ROOT}"
  mkdir -p "${PHASE2A_MIGRATION_DIR}"
  cp migrations/0057_event_suggestions_phase_2a.sql "${PHASE2A_MIGRATION_DIR}/0057_event_suggestions_phase_2a.sql"
  cp wrangler.event-platform-performance-preview.toml "${PHASE2A_MIGRATION_ROOT}/wrangler.toml"
  if [ "$(find "${PHASE2A_MIGRATION_DIR}" -type f | wc -l | tr -d ' ')" != "1" ]; then
    echo "::error::Isolated Phase 2A migration directory must contain exactly one file."
    exit 1
  fi
  ./node_modules/.bin/wrangler d1 migrations apply DB \
    --cwd "${PHASE2A_MIGRATION_ROOT}" \
    --config "${PHASE2A_MIGRATION_ROOT}/wrangler.toml" \
    --remote \
    | tee dzn-event-platform-performance-preview/migration-0057-apply.txt
else
  echo "Migration 0057 already applied; verifying schema without reapplying."
fi

npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "SELECT name FROM d1_migrations WHERE name = '0057_event_suggestions_phase_2a.sql';" > dzn-event-platform-performance-preview/migration-0057-after.json 2> dzn-event-platform-performance-preview/migration-0057-after.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "SELECT name, type FROM sqlite_master WHERE name IN ('event_suggestions','event_suggestion_votes','event_suggestion_reports','event_suggestion_moderation_actions','event_suggestion_servers','idx_event_suggestions_public_hot','idx_event_suggestions_public_created','idx_event_suggestions_public_supported_score','idx_event_suggestions_public_active_total','idx_event_suggestions_owner_review','idx_event_suggestion_votes_suggestion','idx_event_suggestion_reports_user_open') ORDER BY name;" > dzn-event-platform-performance-preview/schema-objects.json 2> dzn-event-platform-performance-preview/schema-objects.stderr.log
for table in event_suggestions event_suggestion_votes event_suggestion_reports event_suggestion_moderation_actions event_suggestion_servers; do
  npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "PRAGMA table_info(${table});" > "dzn-event-platform-performance-preview/table-${table}.json" 2> "dzn-event-platform-performance-preview/table-${table}.stderr.log"
done
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "PRAGMA foreign_key_check;" > dzn-event-platform-performance-preview/foreign-key-check.json 2> dzn-event-platform-performance-preview/foreign-key-check.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT id FROM event_suggestions WHERE public_status IN ('public_voting','shortlisted','accepted','converted_to_event') ORDER BY hot_score DESC, created_at DESC, id DESC LIMIT 21;" > dzn-event-platform-performance-preview/query-plan-trending.json 2> dzn-event-platform-performance-preview/query-plan-trending.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT id FROM event_suggestions WHERE public_status IN ('public_voting','shortlisted','accepted','converted_to_event') ORDER BY created_at DESC, id DESC LIMIT 21;" > dzn-event-platform-performance-preview/query-plan-newest.json 2> dzn-event-platform-performance-preview/query-plan-newest.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT id FROM event_suggestions WHERE public_status IN ('public_voting','shortlisted','accepted','converted_to_event') ORDER BY (upvote_count - downvote_count) DESC, upvote_count DESC, created_at DESC, id DESC LIMIT 21;" > dzn-event-platform-performance-preview/query-plan-most-supported.json 2> dzn-event-platform-performance-preview/query-plan-most-supported.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT id FROM event_suggestions WHERE public_status IN ('public_voting','shortlisted','accepted','converted_to_event') ORDER BY (upvote_count + downvote_count) DESC, upvote_count DESC, created_at DESC, id DESC LIMIT 21;" > dzn-event-platform-performance-preview/query-plan-most-active.json 2> dzn-event-platform-performance-preview/query-plan-most-active.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT id FROM event_suggestions WHERE moderation_status = 'pending_moderation' ORDER BY updated_at DESC, id DESC LIMIT 50;" > dzn-event-platform-performance-preview/query-plan-owner-moderation.json 2> dzn-event-platform-performance-preview/query-plan-owner-moderation.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT vote_value FROM event_suggestion_votes WHERE suggestion_id = 'phase2a-preview-public-voting' AND user_id = 'phase2a-preview-member' LIMIT 1;" > dzn-event-platform-performance-preview/query-plan-vote-lookup.json 2> dzn-event-platform-performance-preview/query-plan-vote-lookup.stderr.log
npx wrangler d1 execute DB --config wrangler.event-platform-performance-preview.toml --remote --json --command "EXPLAIN QUERY PLAN SELECT id FROM event_suggestion_reports WHERE suggestion_id = 'phase2a-preview-reported' AND reporter_user_id = 'phase2a-preview-member' AND status = 'open' LIMIT 1;" > dzn-event-platform-performance-preview/query-plan-report-lookup.json 2> dzn-event-platform-performance-preview/query-plan-report-lookup.stderr.log

node <<'NODE'
const fs = require("node:fs");
function fail(message) {
  console.error(message);
  process.exit(1);
}
function parse(path) {
  const raw = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "").trimStart();
  if (!raw || !["[", "{"].includes(raw[0])) fail(`Malformed Wrangler JSON in ${path}.`);
  return JSON.parse(raw);
}
function rows(path) {
  const parsed = parse(path);
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => item?.results ?? item?.result?.[0]?.results ?? item?.result?.results ?? []);
}
const migrationRows = rows("dzn-event-platform-performance-preview/migration-0057-after.json");
if (migrationRows.length !== 1) fail("Migration 0057 was not recorded/applied exactly once.");
const requiredColumns = {
  event_suggestions: ["id", "submitted_by_user_id", "title", "description", "normalized_title", "content_fingerprint", "competition_format", "platform", "moderation_status", "public_status", "converted_event_id", "upvote_count", "downvote_count", "report_count", "hot_score", "created_at", "updated_at"],
  event_suggestion_votes: ["suggestion_id", "user_id", "vote_value", "created_at", "updated_at"],
  event_suggestion_reports: ["id", "suggestion_id", "reporter_user_id", "reason", "status", "created_at"],
  event_suggestion_moderation_actions: ["id", "suggestion_id", "actor_user_id", "action", "created_at"],
  event_suggestion_servers: ["suggestion_id", "linked_server_id", "relationship_type", "created_at"],
};
const tableSummaries = {};
for (const [table, columns] of Object.entries(requiredColumns)) {
  const names = new Set(rows(`dzn-event-platform-performance-preview/table-${table}.json`).map((row) => row.name));
  for (const column of columns) if (!names.has(column)) fail(`Missing Phase 2A schema column: ${table}.${column}`);
  tableSummaries[table] = { columnCount: names.size };
}
const objects = new Set(rows("dzn-event-platform-performance-preview/schema-objects.json").map((row) => row.name));
for (const name of [
  "idx_event_suggestions_public_hot",
  "idx_event_suggestions_public_created",
  "idx_event_suggestions_public_supported_score",
  "idx_event_suggestions_public_active_total",
  "idx_event_suggestions_owner_review",
  "idx_event_suggestion_votes_suggestion",
  "idx_event_suggestion_reports_user_open",
]) {
  if (!objects.has(name)) fail(`Missing Phase 2A index: ${name}`);
}
if (rows("dzn-event-platform-performance-preview/foreign-key-check.json").length !== 0) fail("Phase 2A preview foreign_key_check returned rows.");
fs.writeFileSync("dzn-event-platform-performance-preview/schema-summary.json", JSON.stringify({
  migration0057Applied: true,
  tables: tableSummaries,
  requiredIndexesPresent: true,
  foreignKeyCheckRows: 0,
  queryPlansCaptured: ["trending", "newest", "most_supported", "most_active", "owner_moderation", "vote_lookup", "report_lookup"],
}, null, 2));
console.log("Phase 2A migration/schema verification passed.");
NODE
