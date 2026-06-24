import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const liveStatsRoute = readFileSync("functions/api/servers/[serverId]/dashboard/live-stats.ts", "utf8");
const serverStats = readFileSync("functions/_lib/server-stats.ts", "utf8");

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`);
  return source.slice(start, end);
}

const liveStatsHelper = sliceBetween(
  serverStats,
  "export async function getCanonicalServerLiveStats",
  "export async function getCanonicalServerRank",
);
const routeRankReader = sliceBetween(
  liveStatsRoute,
  "async function readLightweightRank",
  "function unavailableRank",
);

assert.equal(
  liveStatsRoute.includes("getCanonicalServerRank"),
  false,
  "Hot live-stats route must not call the broad canonical rank helper.",
);
assert.equal(
  liveStatsRoute.includes("getRankedPublicServers"),
  false,
  "Hot live-stats route must not load broad public leaderboard rankings.",
);
assert.equal(
  liveStatsRoute.includes("WITH server_scope"),
  false,
  "Hot live-stats route must not run the all-live-server rank CTE.",
);
assert.equal(
  liveStatsRoute.includes("calculateServerScoreBreakdown"),
  true,
  "Hot live-stats route must calculate score directly from current canonical stats.",
);
assert.equal(
  liveStatsRoute.includes("readLightweightRank"),
  true,
  "Hot live-stats route must use a lightweight durable rank source.",
);
assert.equal(
  liveStatsRoute.includes("rank_source"),
  true,
  "Hot live-stats response must expose rank evidence.",
);
assert.equal(
  routeRankReader.includes("server_public_cache"),
  true,
  "Lightweight rank must come from a durable cache/snapshot source.",
);
assert.equal(
  routeRankReader.includes("WHERE guild_id = ?"),
  true,
  "Lightweight rank lookup must be bounded to one selected server.",
);
assert.equal(
  routeRankReader.includes("LIMIT 1"),
  true,
  "Lightweight rank lookup must be bounded to one row.",
);
assert.equal(
  liveStatsRoute.includes("CREATE TABLE"),
  false,
  "Hot live-stats route must not perform schema setup.",
);
assert.equal(
  liveStatsRoute.includes("CREATE INDEX"),
  false,
  "Hot live-stats route must not create indexes at request time.",
);

assert.equal(
  liveStatsHelper.includes("queryCanonicalServerLiveStats"),
  true,
  "Live-stats must use a dedicated bounded canonical helper.",
);
assert.equal(
  liveStatsHelper.includes("WITH\n      kill_stats AS"),
  true,
  "Live-stats helper must aggregate kill data once for the selected server.",
);
assert.equal(
  liveStatsHelper.includes("player_event_stats AS"),
  true,
  "Live-stats helper must aggregate player events once for the selected server.",
);
assert.equal(
  liveStatsHelper.includes("profile_stats AS"),
  true,
  "Live-stats helper must aggregate player profiles once for the selected server.",
);
assert.equal(
  liveStatsHelper.includes("build_stats AS"),
  true,
  "Live-stats helper must aggregate build events through a bounded selected-server CTE.",
);
assert.equal(
  liveStatsHelper.includes("WHERE linked_server_id = ?"),
  true,
  "Live-stats helper must filter each aggregate by the selected linked server.",
);
assert.equal(
  liveStatsHelper.includes("WITH server_scope"),
  false,
  "Live-stats helper must not include the all-server ranking CTE.",
);
assert.equal(
  liveStatsHelper.includes("getCanonicalServerRankNumber"),
  false,
  "Live-stats helper must not call broad rank computation.",
);

console.log("Dashboard live-stats CPU tests passed.");
