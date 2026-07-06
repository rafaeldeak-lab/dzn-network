import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("functions/api/public/servers.ts", "utf8");
const publicLeaderboards = readFileSync("functions/_lib/public-leaderboards.ts", "utf8");
const homeStats = readFileSync("functions/api/public/home-stats.ts", "utf8");

assert.equal(source.includes("live_query_failed_using_snapshot"), true, "Public servers should use last-good snapshots when available.");
assert.equal(source.includes("live_query_failed_no_snapshot"), true, "Public servers should report no-snapshot fallback state.");
assert.equal(source.includes("status: 200"), true, "No-snapshot public servers fallback should return controlled 200.");
assert.equal(source.includes("servers: []"), true, "No-snapshot public servers fallback should provide an empty safe server list.");
assert.equal(source.includes("server: slug ? null : undefined"), true, "No-snapshot public server profile fallback should not throw.");
assert.doesNotMatch(source, /ensureAdmSyncSchema|ensureBillingSchema|ensurePublicSlugsForLiveServers|uniquePublicSlug/, "Public servers GET must not import heavy schema repair helpers or mutate slugs.");
assert.doesNotMatch(source, /UPDATE\s+linked_servers|CREATE\s+TABLE|ALTER\s+TABLE/i, "Public servers GET must remain read-only.");
assert.doesNotMatch(publicLeaderboards, /from\s+["']\.\/adm-sync["']|ensureAdmSyncSchema/, "Public leaderboard helpers used by public servers must not pull the ADM sync engine into the public hot path.");
assert.doesNotMatch(homeStats, /from\s+["']\.\.\/\.\.\/_lib\/adm-sync["']|ensureAdmSyncSchema|ensureBuildEventSchema|ensureLinkedServerMetadataColumns/, "Public home stats GET must not run schema repair work on request.");

console.log("Public servers fallback tests passed.");
