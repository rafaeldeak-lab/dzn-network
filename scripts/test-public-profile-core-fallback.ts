import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publicServers = readFileSync("functions/api/public/servers.ts", "utf8");
const publicProfileLeaderboards = readFileSync("functions/api/public/servers/[serverId]/leaderboards.ts", "utf8");
const publicProfileExploration = readFileSync("functions/api/public/servers/[serverId]/exploration.ts", "utf8");
const publicProfileWars = readFileSync("functions/api/public/servers/[serverId]/wars/index.ts", "utf8");

const slugFastPathIndex = publicServers.indexOf("if (slug) {\n    return getPublicServerProfileFastPayload");
const broadEnsureIndex = publicServers.indexOf("await ensureLinkedServerMetadataColumns(env)");
const broadRankingIndex = publicServers.indexOf("getRankedPublicServers(env, 500)");

assert.notEqual(slugFastPathIndex, -1, "Public profile slug requests must have a fast core path.");
assert.notEqual(broadEnsureIndex, -1, "Public listing path still owns broad schema helpers.");
assert.notEqual(broadRankingIndex, -1, "Public listing path still owns broad ranking generation.");
assert.equal(
  slugFastPathIndex < broadEnsureIndex && slugFastPathIndex < broadRankingIndex,
  true,
  "Public profile slug requests must return before broad listing/ranking work.",
);
assert.equal(
  publicServers.includes("async function getPublicServerProfileFastPayload"),
  true,
  "Public profiles must use a dedicated bounded profile payload.",
);
assert.equal(
  publicServers.includes("async function querySinglePublicServer"),
  true,
  "Public profiles must query one server by slug/id.",
);
assert.equal(
  publicServers.includes("lightweightRankingFromPublicRow"),
  true,
  "Public profiles must use one durable row for rank/score instead of broad live ranking.",
);
assert.equal(
  publicServers.includes("getPublicServerLeaderboardById(env, row.id, 10).catch"),
  true,
  "Public profile player leaderboard failure must not remove the whole profile.",
);
assert.equal(
  publicServers.includes("getPublicRecentEvents(env, row.id).catch"),
  true,
  "Public profile recent-event failure must not remove the whole profile.",
);
assert.equal(
  publicServers.includes("status: 200"),
  true,
  "Public server API live failure with no snapshot must return a controlled 200 response.",
);

assert.equal(
  publicProfileLeaderboards.includes("available: false"),
  true,
  "Public profile leaderboard optional route must expose controlled unavailability.",
);
assert.equal(
  publicProfileLeaderboards.includes("status: 503"),
  false,
  "Public profile leaderboard optional route must not return HTTP 503 on read failure.",
);
assert.equal(
  publicProfileExploration.includes("available: false"),
  true,
  "Public profile exploration optional route must expose controlled unavailability.",
);
assert.equal(
  publicProfileExploration.includes("status: 503"),
  false,
  "Public profile exploration optional route must not return HTTP 503 on read failure.",
);
assert.equal(
  publicProfileWars.includes("fallback_reason"),
  true,
  "Public Server Wars profile module must keep its controlled fallback.",
);
assert.equal(
  publicProfileWars.includes("status: 503"),
  false,
  "Public Server Wars profile module must not return HTTP 503 on optional failure.",
);
assert.equal(
  publicProfileWars.includes("ok: true") && publicProfileWars.includes("fallback_reason"),
  true,
  "Public Server Wars profile module must return a controlled fallback by default.",
);

console.log("Public profile core fallback tests passed.");
