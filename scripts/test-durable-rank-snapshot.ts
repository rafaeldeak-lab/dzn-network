import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const liveStatsRoute = readFileSync("functions/api/servers/[serverId]/dashboard/live-stats.ts", "utf8").replace(/\r\n/g, "\n");
const publicServersRoute = readFileSync("functions/api/public/servers.ts", "utf8").replace(/\r\n/g, "\n");
const automationSource = readFileSync("functions/_lib/automation.ts", "utf8").replace(/\r\n/g, "\n");
const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8").replace(/\r\n/g, "\n");
const migrationSource = readFileSync("migrations/0015_automation_pipeline.sql", "utf8").replace(/\r\n/g, "\n");
const rankTimestampMigration = readFileSync("migrations/0092_server_public_cache_rank_timestamp.sql", "utf8").replace(/\r\n/g, "\n");

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
  automationSource.includes("server_public_cache has no column named network_rank_updated_at"),
  true,
  "Public cache upserts must tolerate SQLite's INSERT-specific missing-column wording before migration 0092 is applied.",
);
assert.equal(
  rankTimestampMigration.includes("network_rank_updated_at TEXT") &&
    rankTimestampMigration.includes("idx_server_public_cache_network_rank_updated_at"),
  true,
  "Rank snapshots must record their own refresh timestamp through an isolated migration.",
);
assert.equal(
  admSyncSource.includes("network_rank_updated_at FROM server_public_cache") &&
    admSyncSource.includes("no such column: network_rank_updated_at") &&
    admSyncSource.includes("!existingRankSnapshotAt || isIsoOlderThan(existingRankSnapshotAt"),
  true,
  "Quiet scheduled imports must tolerate the pending migration and initialize a missing rank timestamp without relying on mutable cache freshness.",
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
  liveRankReader.includes("network_rank_updated_at") &&
    liveRankReader.includes("no such column: network_rank_updated_at"),
  true,
  "Rank reads must prefer the rank-specific timestamp while retaining a pre-migration compatibility path.",
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
