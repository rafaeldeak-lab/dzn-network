import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPublicAdmStatsSummaryToHomeStats } from "../functions/_lib/server-stats";

const staleHomeStats = {
  totals: {
    killsTracked: 796,
    deathsTracked: 796,
    joinsTracked: 1200,
    totalEventsTracked: 5491,
    longestKill: 51.4,
    players_online: 1,
  } as Record<string, unknown>,
  data: {
    killsTracked: 796,
    totalEventsTracked: 5491,
  } as Record<string, unknown>,
  network_pulse: {
    events: 5491,
  } as Record<string, unknown>,
  playersOnline: 1,
};

const patchedHomeStats = applyPublicAdmStatsSummaryToHomeStats(staleHomeStats, {
  killsTracked: 821,
  deathsTracked: 1223,
  joinsTracked: 1323,
  disconnectsTracked: 205,
  uniquePlayersTracked: 166,
  longestKill: 55.7,
  totalEventsTracked: 7692,
  latestEventAt: "2026-06-06T13:23:10.000Z",
});

assert.equal(patchedHomeStats.totals.killsTracked, 821, "Cached home-stats kills must update from canonical ADM rows.");
assert.equal(patchedHomeStats.totals.totalEventsTracked, 7692, "Cached home-stats Events Tracked must update from canonical ADM rows.");
assert.equal(patchedHomeStats.data?.killsTracked, 821, "Nested home-stats payload must not keep stale kill totals.");
assert.equal(patchedHomeStats.network_pulse?.events, 7692, "Network pulse must use the same canonical event total.");
assert.equal(patchedHomeStats.playersOnline, 1, "ADM stat patch must not alter live player-count fixes.");

const serverStatsSource = readFileSync("functions/_lib/server-stats.ts", "utf8");
const dashboardHealthSource = readFileSync("functions/api/servers/[serverId]/dashboard/health.ts", "utf8");
const dashboardLiveStatsSource = readFileSync("functions/api/servers/[serverId]/dashboard/live-stats.ts", "utf8");
const dashboardComponentSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
const automationStatusSource = readFileSync("functions/api/servers/[serverId]/adm/automation-status.ts", "utf8");
const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
const homeStatsSource = readFileSync("functions/api/public/home-stats.ts", "utf8");
const publicServersSource = readFileSync("functions/api/public/servers.ts", "utf8");
const publicLeaderboardsSource = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const parserTestSource = readFileSync("scripts/test-adm-parser.ts", "utf8");

assert.equal(serverStatsSource.includes("getCanonicalServerStats"), true, "Canonical server stats helper must exist.");
assert.equal(serverStatsSource.includes("FROM kill_events"), true, "Canonical kills must come from imported kill_events.");
assert.equal(serverStatsSource.includes("event_type = 'player_connected'"), true, "Canonical joins must come from player_events.");
assert.equal(serverStatsSource.includes("event_type = 'player_disconnected'"), true, "Canonical disconnects must come from player_events.");
assert.equal(serverStatsSource.includes("build_events"), true, "Events Tracked must include build_events where available.");

assert.equal(dashboardHealthSource.includes("getCanonicalServerStats"), true, "Dashboard health must use canonical server stats.");
assert.equal(dashboardHealthSource.includes("statsFromCanonical"), true, "Dashboard health must map canonical stats into its overview payload.");
assert.equal(dashboardHealthSource.includes("getCanonicalServerRank"), true, "Dashboard health score/rank must use the bounded canonical rank helper.");
assert.equal(dashboardHealthSource.includes("getRankedPublicServers"), false, "Dashboard health must not load every ranked server to find one server.");
assert.equal(dashboardHealthSource.includes("score_label: canonicalRank?.scoreLabel"), true, "Dashboard health must expose the current canonical score label.");
assert.equal(dashboardHealthSource.includes("rank: canonicalRank?.rank"), true, "Dashboard health must expose the current canonical public rank.");
assert.equal(dashboardHealthSource.includes("stats_source: canonicalStats ? \"canonical-adm-events\" : \"server_stats_fallback\""), true, "Dashboard health must label canonical stat source.");
assert.equal(dashboardLiveStatsSource.includes("getCanonicalServerStats"), true, "Dashboard live stats must use canonical server stats.");
assert.equal(dashboardLiveStatsSource.includes("getCanonicalServerRank"), true, "Dashboard live stats must use canonical score/rank.");
assert.equal(dashboardLiveStatsSource.includes("server_public_cache"), false, "Dashboard live stats must not depend on public cache.");
assert.equal(dashboardLiveStatsSource.includes("ensureAdmSyncSchema"), false, "Dashboard live stats must not run schema setup on every poll.");
assert.equal(dashboardLiveStatsSource.includes("Nitrado"), false, "Dashboard live stats must not call Nitrado.");
assert.equal(dashboardComponentSource.includes("formatPlayerCountStatus(dashboardPlayerCount.status, dashboardPlayerCount.checkedAt)"), true, "Dashboard freshness label must use the same timestamp-aware freshness calculation as the detail text.");
assert.equal(dashboardComponentSource.includes("refreshDashboardLiveStats();"), true, "Dashboard must poll the lightweight canonical live-stats endpoint for stat refreshes.");
assert.equal(dashboardComponentSource.includes("const canonicalStats = dashboardLiveStats?.stats"), true, "Dashboard stat cards must prioritize canonical live stats.");
assert.equal(dashboardComponentSource.includes("?? latestCanonicalDashboardHealth?.stats"), true, "Dashboard health canonical stats must remain the secondary stat source.");
assert.equal(dashboardComponentSource.includes("document.addEventListener(\"visibilitychange\""), true, "Dashboard must refetch bounded health/status data when the tab becomes visible.");
assert.equal(dashboardComponentSource.includes("document.visibilityState === \"hidden\""), true, "Dashboard polling must pause while the tab is hidden.");
assert.equal(automationStatusSource.includes("getCanonicalServerStats"), true, "ADM automation status must use canonical server stats.");
assert.equal(admSyncSource.includes("canonicalStats?.kills"), true, "Dashboard sync status must return canonical kills.");
assert.equal(admSyncSource.includes("patchHomeStatsAdmStatsFromCanonicalEvents"), true, "Successful ADM imports must refresh home-stats ADM snapshots.");

assert.equal(homeStatsSource.includes("getPublicAdmStatsSummary"), true, "Home stats must use canonical public ADM totals.");
assert.equal(homeStatsSource.includes("refreshHomeStatsLiveCounters"), true, "Cached home-stats snapshots must receive fresh player and ADM overlays.");
assert.equal(homeStatsSource.includes("approximateNetworkEventTotalFromTotals"), false, "Home stats must not rely on stale server_stats event approximation.");
assert.equal(publicServersSource.includes("FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id"), true, "Public servers must use canonical kill_events counts.");
assert.equal(publicServersSource.includes("player_events.event_type = 'player_connected'"), true, "Public servers must use canonical join counts.");
assert.equal(publicLeaderboardsSource.includes("player_events.event_type = 'player_connected'"), true, "Public leaderboards must use canonical join counts.");

assert.equal(parserTestSource.includes("nonKillDamageLines"), true, "ADM parser tests must cover non-kill damage lines.");
assert.equal(parserTestSource.includes("uploadedDeadHits"), true, "ADM parser tests must cover DEAD hit lines.");
assert.equal(parserTestSource.includes("filter((event) => event.eventType === \"player_killed\" && event.isCreditedKill).length"), true, "ADM parser tests must assert credited kill counts.");

console.log("Dashboard/stat parity tests passed.");
