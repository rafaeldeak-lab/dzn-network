import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const liveStatsRoute = readFileSync("functions/api/servers/[serverId]/dashboard/live-stats.ts", "utf8");
const publicServersRoute = readFileSync("functions/api/public/servers.ts", "utf8");
const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");
const migrationSource = readFileSync("migrations/0015_automation_pipeline.sql", "utf8");

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`);
  return source.slice(start, end);
}

const liveRankReader = sliceBetween(
  liveStatsRoute,
  "async function readLightweightRank",
  "function unavailableRank",
);
const publicProfileFastPath = sliceBetween(
  publicServersRoute,
  "async function getPublicServerProfileFastPayload",
  "async function querySinglePublicServer",
);
const publicProfileRanking = sliceBetween(
  publicServersRoute,
  "function lightweightRankingFromPublicRow",
  "async function queryPublicServersPreview",
);

assert.equal(
  migrationSource.includes("network_rank INTEGER"),
  true,
  "Durable public cache schema must contain a rank snapshot.",
);
assert.equal(
  migrationSource.includes("idx_server_public_cache_network_rank"),
  true,
  "Durable rank snapshot must remain indexed.",
);
assert.equal(
  automationSource.includes("network_rank"),
  true,
  "Automation/public cache refresh path must persist rank snapshots.",
);
assert.equal(
  automationSource.includes("readNetworkRankSnapshot") &&
    automationSource.includes("input.lastAdmUpdateAt") &&
    automationSource.includes("input.networkRank !== undefined"),
  true,
  "ADM/public cache freshness updates must refresh durable rank snapshots unless an explicit rank is supplied.",
);

assert.equal(
  liveStatsRoute.includes("getCanonicalServerRank"),
  false,
  "Dashboard live-stats must not use the broad live rank helper.",
);
assert.equal(
  liveStatsRoute.includes("getRankedPublicServers"),
  false,
  "Dashboard live-stats must not load all public rankings.",
);
assert.equal(
  liveRankReader.includes("FROM server_public_cache"),
  true,
  "Dashboard live-stats rank must come from the durable cache snapshot.",
);
assert.equal(
  liveRankReader.includes("WHERE guild_id = ?"),
  true,
  "Dashboard live-stats rank lookup must be bounded to the selected guild.",
);
assert.equal(
  liveStatsRoute.includes("rank: null"),
  true,
  "Missing rank must return null without failing canonical stats.",
);
assert.equal(
  liveStatsRoute.includes('"leaderboard_snapshot"'),
  true,
  "Dashboard live-stats must expose rank_source evidence.",
);

assert.equal(
  publicProfileFastPath.includes("lightweightRankingFromPublicRow(row)"),
  true,
  "Public profile fast path must use durable row rank/score evidence.",
);
assert.equal(
  publicProfileRanking.includes("server_public_cache.network_rank"),
  false,
  "Public profile ranking helper must not issue additional cache queries.",
);
assert.equal(
  publicProfileRanking.includes("rank: numberOrZero(row.network_rank) || null"),
  true,
  "Public profile ranking helper must preserve missing rank as null.",
);
assert.equal(
  publicProfileRanking.includes("calculateServerScoreBreakdown"),
  true,
  "Public profile score may be calculated directly from the selected server row.",
);

console.log("Durable rank snapshot tests passed.");
