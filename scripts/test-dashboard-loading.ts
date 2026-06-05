import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  "withHomeStatsEvidence",
  "hasAdmData",
  "everSyncedAdm",
  "lastSuccessfulAdmImportAt",
  "statsActiveServers",
  "killsTracked",
  "totalEventsTracked",
  "recentActivityCount",
  "recentEventsCount",
  "getMonotonicNetworkEventTotal",
  "approximateNetworkEventTotalFromTotals",
  "getMonotonicNetworkEventTotal(env, approximateNetworkEventTotalFromTotals(totals))",
  "public_home_stats_monotonic_guard",
  "Math.max(calculated, cachedTotal)",
  "events: totalEventsTracked",
  "mapNodes",
  "source: \"last_known\"",
  "source: \"fallback_empty\"",
  "live_query_failed_using_db_last_known",
  "live_query_failed_using_snapshot",
  "live_query_failed_no_snapshot",
  "retry_after_seconds: 10",
  "HOME_STATS_NO_STORE_HEADERS",
  "logPublicApiLoadFailed",
  "logPublicApiSnapshotFallbackServed",
]);
assert.equal(homeStatsRoute.includes("status: 503"), false, "Home stats should not turn recoverable public fallback into a first-sync 503.");
assert.equal(homeStatsRoute.includes("publicApiErrorHeaders()"), false, "Home stats should use no-store JSON fallback instead of cached error payloads.");
assert.equal(homeStatsRoute.includes("withPublicApiMetadata(applyHomeStatsAccess(emptyHomeStats()"), false, "Home stats must not return fake zero payloads as successful fallback responses.");
assert.equal(homeStatsRoute.includes("server_stats.longest_kill_distance"), false, "Home stats must not query non-existent server_stats longest-kill columns.");
assert.equal(homeStatsRoute.includes("lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'"), true, "Homepage stats should treat NULL listing visibility as public.");
assert.equal(homeStatsRoute.includes("listing_visibility = 'public'"), false, "Homepage stats must not exclude NULL visibility public servers.");
const previewAccessSource = homeStatsRoute.slice(homeStatsRoute.indexOf("export function applyHomeStatsAccess"));
assert.equal(previewAccessSource.includes("killsTracked: 0"), false, "Homepage preview must not replace real aggregate kill totals with fake zeroes.");
assert.equal(previewAccessSource.includes("recentEventsCount: 0"), false, "Homepage preview must not replace real aggregate event totals with fake zeroes.");
assert.equal(previewAccessSource.includes("totalEventsTracked: 0"), false, "Homepage preview must not replace monotonic all-time event totals with fake zeroes.");

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
  "payload.data && !payload.totals ? payload.data : payload",
  "hasAdmData",
  "everSyncedAdm",
  "lastSuccessfulAdmImportAt",
  "totalEventsTracked",
  "Events Tracked",
  "All-time ADM events tracked",
  "Syncing latest ADM rankings",
  "Syncing latest ADM activity",
  "Updated from last synced ADM",
]);
assert.equal(landing.includes("homeStats.network_pulse.events || homeStats.totals.recentEventsCount"), false, "Homepage Events card must not use recentEventsCount as its primary network total.");
assert.equal(landing.includes("Math.max(homeStats.totalEventsTracked, homeStats.totals.totalEventsTracked"), true, "Homepage Events card must prefer totalEventsTracked.");
assert.equal(landing.includes("Awaiting first synced ADM data"), false, "Homepage must not render fake first-sync copy while ADM data exists.");
assert.equal(landing.includes("Awaiting ADM data"), false, "Homepage stat cards must not replace last-known ADM numbers with awaiting copy.");
assert.equal(landing.includes("Checking ADM Data"), false, "Homepage must not show checking-copy as a permanent public state.");
assert.equal(landing.includes("&& !hasMeaningfulHomeStats(displayHomeStats)"), true, "Homepage should use last-known ADM data instead of pending copy when stats exist.");
assert.equal(landing.includes("dataPending ? \"Refreshing\""), false, "Homepage must not render Refreshing as every stat-card value.");
assert.equal(landing.includes("dataPending ? \"Loading\""), false, "Homepage stat cards must not render generic Loading as every stat-card value.");
assert.equal(landing.includes("setData(emptyHomeStats"), false, "Homepage refresh failures must not reset stats to empty defaults.");
assert.equal(landing.includes("Live refresh recovering. Showing last known data."), false, "Homepage must not show stale-data warning when valid data is visible.");
assert.equal(landing.includes("Network stats refresh failed. Showing last known values."), false, "Homepage refresh failures with visible data should stay silent.");
includesAll(landing, [
  "SiteHeader",
  "authenticated={authState.status === \"logged_in\"}",
  "checkingAccount={authState.status === \"loading\"}",
]);
assert.equal(landing.includes("function Navbar"), false, "Homepage must use the shared SiteHeader instead of the duplicate local navbar.");

const leaderboards = source("app/leaderboards/page.tsx");
includesAll(leaderboards, [
  "dzn:lastGoodLeaderboard",
  "loadLastGoodLeaderboard",
  "saveLastGoodLeaderboard",
  "hasMeaningfulLeaderboard",
  "latestRequestId",
  "fetchJsonWithRetry<LeaderboardsPayload>",
  "/api/public/leaderboards",
  "LEADERBOARD_LAST_GOOD_MAX_AGE_MS",
  "error_initial",
  "data.data && !data.top_servers ? data.data : data",
  "Leaderboard data could not be loaded right now.",
  "KillProjectileAccent",
  "AnimatedBullet",
  "SiteHeader",
  "active=\"leaderboards\"",
  "leaderboard-ref-page",
  "leaderboard-ref-hero-art",
  "leaderboard-ref-stats",
  "leaderboard-ref-grid",
  "leaderboard-ref-kill-card",
  "leaderboard-ref-kill-card-bg",
  "leaderboard-ref-kill-card-content",
  "leaderboard-reference-page",
  "leaderboard-reference-grid",
  "leaderboard-reference-stat-grid",
  "leaderboard-reference-longest-card",
  "dzn-leaderboard-hero",
  "dzn-leaderboard-hero__intel",
  "dzn-leaderboard-stat-grid",
  "Global Leaderboards",
  "Servers Ranked",
  "Kills Tracked",
  "Ranked Players",
  "Longest Kill",
  "One Shot Kill",
  "Top Servers",
  "Top Players",
  "Personal Bests",
  "Longest Kills",
  "payload.top_servers.map",
  "payload.top_players.map",
]);
assert.equal(leaderboards.includes("Live refresh recovering. Showing last known data."), false, "Leaderboards must not show stale-data warning when valid data is visible.");
assert.equal(leaderboards.includes("Live data refresh failed. Showing last known leaderboard."), false, "Leaderboards refresh failures with visible data should stay silent.");
assert.equal(leaderboards.includes("function LeaderboardNav"), false, "Leaderboards page must use the shared SiteHeader instead of a duplicate local nav.");
assert.equal(leaderboards.includes("leaderboard-ref-nav"), false, "Leaderboards page must not render the old local nav classes.");
assert.equal(leaderboards.includes("Real players."), false, "Leaderboards page must not render the redundant lower CTA card.");
assert.equal(leaderboards.includes("Real action."), false, "Leaderboards page must not render the redundant lower CTA card.");
assert.equal(leaderboards.includes("View full leaderboards"), false, "Leaderboards page must not render the redundant lower CTA button.");
assert.equal(leaderboards.includes("leaderboard-ref-area--cta"), false, "Leaderboards grid must not reserve space for the removed CTA card.");
for (const fakeStaticName of ["NukeTown DEATHMATCH", "PANDORA DayZ", "xAKA-MINI_KickAs", "MikeI-trives-esp"]) {
  assert.equal(leaderboards.includes(fakeStaticName), false, "Leaderboards page must not replace API data with static mock rows.");
}

const leaderboardAccent = source("components/leaderboards/animated-bullet.tsx");
includesAll(leaderboardAccent, [
  "AnimatedBullet",
  "leaderboard-ref-bullet-effects",
  "leaderboard-ref-bullet-glow",
  "leaderboard-ref-bullet-heat",
  "leaderboard-ref-bullet-spark spark-one",
  "leaderboard-ref-bullet-wave wave-one",
  "leaderboard-ref-kill-art",
  "/leaderboards/sniper-accent.png",
  "/leaderboards/rifle-accent.png",
]);

const globals = source("app/globals.css");
includesAll(globals, [
  ".dzn-header-shell",
  ".dzn-header-nav",
  ".dzn-header-logo",
  ".dzn-header-logo-frame",
  ".dzn-header-links",
  ".dzn-header-actions",
  ".dzn-header-action",
  ".leaderboard-ref-page",
  ".leaderboard-ref-shell",
  ".leaderboard-ref-hero",
  ".leaderboard-ref-hero-art",
  ".leaderboard-ref-title",
  ".leaderboard-ref-stats",
  ".leaderboard-ref-stat-card",
  ".leaderboard-ref-grid",
  ".leaderboard-ref-main",
  ".leaderboard-ref-side",
  ".leaderboard-ref-panel",
  ".leaderboard-ref-table",
  ".leaderboard-ref-rank",
  ".leaderboard-ref-longest",
  ".leaderboard-ref-kill-card",
  ".leaderboard-ref-kill-art",
  ".leaderboard-ref-kill-card--bullet",
  ".leaderboard-ref-kill-card-bg",
  ".leaderboard-ref-kill-card-content",
  ".leaderboard-ref-bullet-effects",
  ".leaderboard-ref-bullet-glow",
  ".leaderboard-ref-bullet-heat",
  ".leaderboard-ref-bullet-spark",
  ".leaderboard-ref-bullet-wave",
  ".leaderboard-ref-embers",
  ".leaderboard-reference-page",
  ".leaderboard-reference-hero",
  ".leaderboard-reference-grid",
  ".leaderboard-reference-panel",
  ".leaderboard-reference-stat",
  ".leaderboard-reference-longest-card",
  ".leaderboard-reference-rifle-svg",
  ".leaderboard-reference-weapon-accent",
  ".leaderboard-reference-tracer",
  ".dzn-kill-projectile",
  ".dzn-kill-projectile-svg",
  ".dzn-kill-tracer",
  ".dzn-kill-ember",
  ".dzn-leaderboard-card",
  ".dzn-leaderboard-row:hover",
  "url(\"/leaderboards/leaderboard-hero-battlefield.png\")",
  "url(\"/leaderboards/sniper-accent.png\")",
  "url(\"/leaderboards/rifle-accent.png\")",
  "url(\"/leaderboards/bullet-tracer-accent.png\")",
  "@keyframes refEmberDrift",
  "@keyframes refCardPulse",
  "@keyframes refTracerShimmer",
  "@keyframes leaderboard-ref-bullet-bg-flicker",
  "@keyframes leaderboard-ref-bullet-glow-pulse",
  "@keyframes leaderboard-ref-bullet-heat-shimmer",
  "@keyframes leaderboard-ref-bullet-spark-drift",
  "@keyframes leaderboard-ref-bullet-wave-pulse",
  "@keyframes signalSweep",
  "@keyframes killRoundSpin",
  "@keyframes killTracerDrift",
  "@keyframes killEmberDrift",
  "@keyframes heroParallax",
  "@media (prefers-reduced-motion: reduce)",
]);

const siteHeader = source("components/site-header.tsx");
includesAll(siteHeader, [
  "SiteHeader",
  "/media/dzn-logo.png",
  "DZN_DISCORD_INVITE_URL",
  "/#features",
  "/leaderboards",
  "/servers",
  "/#pricing",
  "/#stats",
  "/events",
  "/dashboard",
  "/setup",
  "logoutAndRedirect",
  "dzn-header-shell",
  "dzn-header-nav",
  "dzn-header-logo",
  "dzn-header-links",
  "dzn-header-actions",
]);

for (const assetPath of [
  "public/leaderboards/leaderboard-hero-battlefield.png",
  "public/leaderboards/sniper-accent.png",
  "public/leaderboards/rifle-accent.png",
  "public/leaderboards/bullet-tracer-accent.png",
  "public/leaderboards/cta-survivor-scene.png",
]) {
assert.equal(existsSync(assetPath), true, `${assetPath} must exist for the cinematic leaderboard reference rebuild.`);
}
assert.equal(leaderboards.includes("LiveAdmIntelPanel"), false, "Leaderboards page must not keep the removed lower CTA component.");
assert.equal(leaderboards.includes("leaderboard-reference-cta-card"), false, "Leaderboards page must not render the removed lower CTA card.");
assert.equal(globals.includes(".dzn-bullet-wrap"), false, "Global Leaderboards hero must not keep the old giant bullet wrapper CSS.");
assert.equal(leaderboardAccent.includes("leaderboard-ref-bullet-img"), false, "One Shot Kill must not render the full tracer PNG as the spinning foreground bullet.");
assert.equal(globals.includes(".leaderboard-ref-bullet-img"), false, "The full tracer PNG must not keep the old spinning foreground CSS.");
for (const removedBulletClass of ["leaderboard-ref-bullet-only", "leaderboard-ref-bullet-scene", "leaderboard-ref-bullet-flight", "leaderboard-ref-bullet-trail", "leaderboard-ref-bullet-ember", "leaderboard-ref-bullet-shockwave"]) {
  assert.equal(leaderboardAccent.includes(removedBulletClass), false, `Animated bullet component must not render duplicate/generated bullet layer ${removedBulletClass}.`);
  assert.equal(globals.includes(`.${removedBulletClass}`), false, `Global CSS must not keep duplicate/generated bullet layer ${removedBulletClass}.`);
}
for (const removedAnimation of ["leaderboard-ref-bullet-spin", "leaderboard-ref-bullet-spiral", "leaderboard-ref-bullet-flight", "leaderboard-ref-tracer-flicker"]) {
  assert.equal(globals.includes(removedAnimation), false, `Global CSS must not keep old rotating bullet animation ${removedAnimation}.`);
}

const publicNetwork = source("components/network/public-network.tsx");
includesAll(publicNetwork, [
  "SiteHeader",
  "active=\"servers\"",
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
]);
assert.equal(publicNetwork.includes("setServer(null);\n      setServers([]);\n      setStats(null);"), false, "Public network load start must not clear cached server/listing data.");
assert.equal(publicNetwork.includes("Live refresh recovering. Showing last known data."), false, "Public network must not show stale-data warning when valid data is visible.");
assert.equal(publicNetwork.includes("Live data refresh failed. Showing last known public data."), false, "Public network refresh failures with visible data should stay silent.");

const changedFiles = execSync("git diff --name-only", { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const allowsTelemetryAdmSyncChange =
  changedFiles.includes("functions/_lib/adm-sync.ts") &&
  source("functions/_lib/adm-sync.ts").includes("PREMIUM_TELEMETRY_SCHEMA_STATEMENTS") &&
  source("functions/_lib/adm-sync.ts").includes("evaluateLogTelemetrySequence") &&
  source("migrations/0031_premium_analytics_telemetry.sql").includes("player_parser_state");
const allowsAdmBuildParserChange =
  changedFiles.includes("functions/_lib/build-events.ts") &&
  source("functions/_lib/adm-parser.ts").includes("territory_flag_raised") &&
  source("functions/_lib/adm-parser.ts").includes("player_folded_structure") &&
  source("functions/_lib/build-events.ts").includes("flag_raised") &&
  source("functions/_lib/build-events.ts").includes("tripwiretrap");
const forbiddenAdmChanges = changedFiles.filter((file) => [
  "functions/_lib/adm-parser.ts",
  "scripts/import-adm-files.ts",
  "scripts/diagnose-adm-import.ts",
].includes(file) && !allowsAdmBuildParserChange || (file === "functions/_lib/adm-sync.ts" && !allowsTelemetryAdmSyncChange && !allowsAdmBuildParserChange) || (/^migrations\//.test(file) && /adm/i.test(file)));
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
assert.equal(workflow.includes("Metadata sync: skipped; status=handled by dedicated metadata cadence outside ADM backup workflow"), true);
assert.equal(workflow.includes("Public snapshots: skipped; status=handled by public snapshot prewarm outside ADM backup workflow"), true);
includesAll(workflow, [
  "Authorization: Bearer ${CRON_SECRET}",
]);
assert.equal(workflow.includes("/api/sync/public-snapshots/run"), false, "The ADM backup workflow must not block on public snapshot prewarm.");

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
