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
  "public_stats_snapshots",
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
  "DZN PUBLIC API LOAD FAILED",
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
  "status: 500",
  "ok: false",
  "publicApiErrorHeaders()",
  "logPublicApiLoadFailed",
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
    "status: 500",
    "publicApiErrorHeaders()",
    "logPublicApiLoadFailed",
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
  "Network stats refreshing. Showing last known values.",
  "dataPending ? \"Refreshing\"",
]);
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
  "Live data refreshing. Showing last known leaderboard.",
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
  "Live data refreshing. Showing last known public data.",
]);
assert.equal(publicNetwork.includes("setServer(null);\n      setServers([]);\n      setStats(null);"), false, "Public network load start must not clear cached server/listing data.");

const admDiff = execSync("git diff --name-only -- functions/_lib/adm-sync.ts functions/_lib/adm-parser.ts scripts/import-adm-files.ts scripts/diagnose-adm-import.ts migrations", { encoding: "utf8" }).trim();
assert.equal(admDiff, "", `ADM reliability files must remain untouched by public loading changes: ${admDiff}`);

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

console.log("Dashboard/public loading last-good regression checks passed.");
