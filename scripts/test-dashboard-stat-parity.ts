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
