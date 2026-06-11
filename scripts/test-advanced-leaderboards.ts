import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const advancedSource = readFileSync("functions/_lib/advanced-leaderboards.ts", "utf8");
const publicAdvancedApi = readFileSync("functions/api/public/leaderboards/advanced.ts", "utf8");
const publicServerAdvancedApi = readFileSync("functions/api/public/servers/[serverId]/leaderboards.ts", "utf8");
const publicExplorationApi = readFileSync("functions/api/public/servers/[serverId]/exploration.ts", "utf8");
const ownerAdvancedApi = readFileSync("functions/api/servers/[serverId]/dashboard/advanced-stats.ts", "utf8");
const previewSeed = readFileSync("scripts/seed-advanced-showcase-preview.ts", "utf8");

assert.match(advancedSource, /getCanonicalServerStats/);
assert.match(advancedSource, /queryPositionSamples/);
assert.match(advancedSource, /limit: 15_000/);
assert.match(advancedSource, /raw player coordinates and exact routes are not exposed/i);
assert.match(advancedSource, /access\.publicMapOverlay \|\| ownerScoped/);
assert.match(advancedSource, /canShowMapOverlay \? exploration : \{ \.\.\.exploration, overlayCells: \[\] \}/);
assert.doesNotMatch(publicExplorationApi, /position_x|position_y|pos_x|pos_y/);
assert.doesNotMatch(publicServerAdvancedApi, /position_x|position_y|pos_x|pos_y/);
assert.match(publicAdvancedApi, /publicAccessCacheHeaders/);
assert.match(publicServerAdvancedApi, /publicAccessCacheHeaders/);
assert.match(ownerAdvancedApi, /requireServerOwnerOrDznAdmin/);
assert.match(ownerAdvancedApi, /unauthenticated/);
assert.match(ownerAdvancedApi, /private, max-age=20/);
assert.match(previewSeed, /local-preview only/i);
assert.match(previewSeed, /"--local"/);
assert.match(previewSeed, /must never run with --remote/);
assert.doesNotMatch(previewSeed, /\["wrangler",\s*"d1",\s*"execute",\s*"dzn_network_db",\s*"--remote"/);
assert.doesNotMatch(previewSeed, /DELETE\s+FROM/i);

console.log("Advanced leaderboard API safety tests passed.");
