import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function includesAll(file: string, snippets: string[]) {
  for (const snippet of snippets) {
    assert.equal(file.includes(snippet), true, `Expected source to include: ${snippet}`);
  }
}

const publicCache = source("functions/_lib/public-api-cache.ts");
includesAll(publicCache, [
  "public_api_snapshots",
  "public_stats_snapshots",
  "access_level TEXT NOT NULL",
  "expires_at TEXT",
  "snapshot_key TEXT NOT NULL UNIQUE",
  "payload_json TEXT NOT NULL",
  "generated_at TEXT NOT NULL",
  "writePublicApiCache",
  "readPublicApiCache",
  "withPublicApiMetadata",
  "ok: true",
  "data: payload",
  "stale",
  "fallback_reason",
  "logPublicApiLoadFailed",
  "DZN PUBLIC API LIVE QUERY FAILED",
  "DZN PUBLIC API SNAPSHOT FALLBACK SERVED",
  "DZN PUBLIC API 503 ROOT CAUSE",
  "publicApiSnapshotFallbackHeaders",
]);

const publicAuth = source("functions/_lib/public-auth.ts");
includesAll(publicAuth, [
  "publicAccessCacheHeaders",
  "public, max-age=15, stale-while-revalidate=45",
  "publicApiErrorHeaders",
  "no-store, no-cache, must-revalidate",
]);

const clientFetch = source("lib/client-fetch.ts");
includesAll(clientFetch, [
  "fetchJsonWithRetry",
  "DZN FETCH RETRY",
  "RETRYABLE_STATUSES",
  "408",
  "429",
  "500",
  "504",
]);

const homeStatsRoute = source("functions/api/public/home-stats.ts");
includesAll(homeStatsRoute, [
  "home-stats:full",
  "home-stats:preview",
  "readPublicApiCache",
  "writePublicApiCache",
  "live_query_failed_using_snapshot",
  "live_query_failed_no_snapshot",
  "status: 503",
  "ok: false",
  "retry_after_seconds: 10",
  "publicApiErrorHeaders()",
  "logPublicApiLoadFailed",
  "logPublicApiSnapshotFallbackServed",
]);
assert.equal(homeStatsRoute.includes("withPublicApiMetadata(applyHomeStatsAccess(emptyHomeStats()"), false, "Home stats must not return fake zero payloads as successful fallback responses.");
assert.equal(homeStatsRoute.includes("server_stats.longest_kill_distance"), false, "Home stats must not query non-existent server_stats longest-kill columns.");
const previewAccessSource = homeStatsRoute.slice(homeStatsRoute.indexOf("export function applyHomeStatsAccess"));
assert.equal(previewAccessSource.includes("killsTracked: 0"), false, "Homepage preview must not replace real aggregate kill totals with fake zeroes.");
assert.equal(previewAccessSource.includes("recentEventsCount: 0"), false, "Homepage preview must not replace real aggregate event totals with fake zeroes.");

for (const route of [
  "functions/api/public/leaderboards.ts",
  "functions/api/public/server-leaderboard.ts",
  "functions/api/public/servers.ts",
]) {
  const routeSource = source(route);
  includesAll(routeSource, [
    "readPublicApiCache",
    "writePublicApiCache",
    "live_query_failed_using_snapshot",
    "live_query_failed_no_snapshot",
    "status: 503",
    "retry_after_seconds: 10",
    "publicApiErrorHeaders()",
    "logPublicApiLoadFailed",
    "logPublicApiSnapshotFallbackServed",
  ]);
}

const landing = source("components/dzn/dzn-landing-page.tsx");
includesAll(landing, [
  "dzn:lastGoodHomeStats",
  "loadLastGoodHomeStats",
  "saveLastGoodHomeStats",
  "hasMeaningfulHomeStats",
  "latestRequestId",
  "fetchJsonWithRetry<HomeStatsResponse>",
  "HOME_STATS_LAST_GOOD_MAX_AGE_MS",
  "Network stats refresh failed. Showing last known values.",
  "payload.data && !payload.totals ? payload.data : payload",
  "Live refresh recovering. Showing last known data.",
  "dataPending ? \"Loading\"",
  "Loading live network data...",
]);
assert.equal(landing.includes("dataPending ? \"Refreshing\""), false, "Homepage must not render Refreshing as every stat-card value.");
assert.equal(landing.includes("setData(emptyHomeStats"), false, "Homepage refresh failures must not reset stats to empty defaults.");

const leaderboards = source("app/leaderboards/page.tsx");
includesAll(leaderboards, [
  "dzn:lastGoodLeaderboard",
  "loadLastGoodLeaderboard",
  "saveLastGoodLeaderboard",
  "hasMeaningfulLeaderboard",
  "latestRequestId",
  "fetchJsonWithRetry<LeaderboardsPayload>",
  "LEADERBOARD_LAST_GOOD_MAX_AGE_MS",
  "error_initial",
  "data.data && !data.top_servers ? data.data : data",
  "Live refresh recovering. Showing last known data.",
  "Leaderboard data could not be loaded right now.",
]);

const publicNetwork = source("components/network/public-network.tsx");
includesAll(publicNetwork, [
  "dzn:lastGoodPublicNetwork:",
  "loadPublicNetworkCache",
  "savePublicNetworkCache",
  "fetchJsonWithRetry<PublicServersResponse>",
  "PUBLIC_NETWORK_CACHE_MAX_AGE_MS",
  "loading_initial",
  "empty_real_data",
  "Unable to load public servers right now.",
  "Server list unavailable",
  "payload = data.data && !data.servers && !data.server ? data.data : data",
  "Live refresh recovering. Showing last known data.",
]);
assert.equal(publicNetwork.includes("setServer(null);\n      setServers([]);\n      setStats(null);"), false, "Public network load start must not clear cached server/listing data.");

const changedFiles = execSync("git diff --name-only", { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const allowsTelemetryAdmSyncChange =
  changedFiles.includes("functions/_lib/adm-sync.ts") &&
  source("functions/_lib/adm-sync.ts").includes("PREMIUM_TELEMETRY_SCHEMA_STATEMENTS") &&
  source("functions/_lib/adm-sync.ts").includes("evaluateLogTelemetrySequence") &&
  source("migrations/0031_premium_analytics_telemetry.sql").includes("player_parser_state");
const forbiddenAdmChanges = changedFiles.filter((file) => [
  "functions/_lib/adm-parser.ts",
  "scripts/import-adm-files.ts",
  "scripts/diagnose-adm-import.ts",
].includes(file) || (file === "functions/_lib/adm-sync.ts" && !allowsTelemetryAdmSyncChange) || (/^migrations\//.test(file) && /adm/i.test(file)));
assert.deepEqual(forbiddenAdmChanges, [], `ADM reliability files must remain untouched by public loading changes: ${forbiddenAdmChanges.join(", ")}`);

const publicSnapshotRun = source("functions/api/sync/public-snapshots/run.ts");
includesAll(publicSnapshotRun, [
  "requireCronSecret",
  "prewarmPublicApiSnapshots",
  "home-stats:preview",
  "home-stats:full",
  "servers:preview",
  "servers:full",
  "leaderboards:preview",
  "leaderboards:full",
  "server-leaderboard:preview",
  "server-leaderboard:full",
  "DZN PUBLIC SNAPSHOTS PREWARMED",
]);

const workflow = source(".github/workflows/dzn-adm-sync.yml");
assert.equal(workflow.indexOf("/api/sync/metadata/run") < workflow.indexOf("/api/sync/adm/run"), true, "Metadata sync must run before ADM sync.");
assert.equal(workflow.indexOf("/api/sync/adm/run") < workflow.indexOf("/api/sync/public-snapshots/run"), true, "Public snapshots must prewarm after ADM sync.");
includesAll(workflow, [
  "/api/sync/public-snapshots/run",
  "Authorization: Bearer ${DZN_CRON_SECRET}",
]);

const packageSource = source("package.json");
assert.equal(packageSource.includes("\"prewarm:public\": \"tsx scripts/prewarm-public-snapshots.ts\""), true);
const prewarmScript = source("scripts/prewarm-public-snapshots.ts");
includesAll(prewarmScript, [
  "https://dzn-network.pages.dev/api/sync/public-snapshots/run",
  "DZN PUBLIC SNAPSHOTS PREWARMED",
  "DZN_CRON_SECRET",
]);

const dashboardHealthRoute = source("functions/api/servers/[serverId]/dashboard/health.ts");
includesAll(dashboardHealthRoute, [
  "requireServerOwnerOrDznAdmin",
  "current_plan",
  "subscription_status",
  "stats",
  "latest_events",
  "active_job",
  "backfill_status",
  "cron",
  "warnings",
]);

const dashboardApi = source("components/onboarding/api.ts");
includesAll(dashboardApi, [
  "getDashboardHealth",
  "/api/servers/${encodeURIComponent(linkedServerId)}/dashboard/health",
]);

const dashboard = source("components/onboarding/dashboard.tsx");
includesAll(dashboard, [
  "dzn:lastGoodDashboard:",
  "dzn:lastGoodSyncHealth:",
  "refreshDashboardHealth",
  "effectiveDashboardHealth",
  "dashboardStatValues",
  "formatNullableDashboardNumber",
  "effectivePlanLabel",
  "DashboardDataHealthPanel",
  "Showing last successful data",
  "Promise.resolve().then(refreshDashboardHealth)",
  "dashboardHealthJobToAdmJob",
]);
assert.equal(dashboard.includes('planLabel("free")'), false, "Dashboard must not downgrade the current plan to Free from a missing billing response.");

const migration = source("migrations/0028_public_stats_snapshots.sql");
includesAll(migration, [
  "CREATE TABLE IF NOT EXISTS public_stats_snapshots",
  "snapshot_key TEXT NOT NULL UNIQUE",
  "payload_json TEXT NOT NULL",
]);

const publicApiMigration = source("migrations/0029_public_api_snapshots.sql");
includesAll(publicApiMigration, [
  "CREATE TABLE IF NOT EXISTS public_api_snapshots",
  "snapshot_key TEXT PRIMARY KEY",
  "access_level TEXT NOT NULL",
  "payload_json TEXT NOT NULL",
  "generated_at TEXT NOT NULL",
]);

console.log("Dashboard/public loading last-good regression checks passed.");
