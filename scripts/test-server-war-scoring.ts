import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scoringSource = readFileSync("functions/_lib/server-war-scoring.ts", "utf8");
const snapshotSource = readFileSync("functions/_lib/server-war-snapshots.ts", "utf8");
const finalizeSource = readFileSync("functions/_lib/server-war-finalize.ts", "utf8");
const publicApi = readFileSync("functions/api/public/server-wars/index.ts", "utf8");
const publicDetailApi = readFileSync("functions/api/public/server-wars/[eventId].ts", "utf8");

for (const snippet of [
  "computeServerWarScore",
  "datetime(COALESCE(occurred_at, created_at)) >= datetime(?)",
  "datetime(COALESCE(occurred_at, created_at)) < datetime(?)",
  "minimumServerKillsForKd: combat.kills >= 25",
  "minimumUniqueFighters: combat.uniqueFighters >= 3",
  "raidScore",
  "buildScore",
  "estimated",
  "computeTravelStats",
  "summarizeMapExploration",
  "getWindowPositionSamples",
  "Travel and exploration metrics are estimated",
]) {
  assert.equal(scoringSource.includes(snippet), true, `Expected scoring source to include ${snippet}.`);
}

assert.equal(/score\s=.*plan|plan.*score|visibility_weight.*score/i.test(scoringSource), false, "Plan tier must not influence Server Wars score.");
assert.equal(/raw_line|TOKEN_ENCRYPTION_KEY|NITRADO_TOKEN|STRIPE_SECRET|player_stats/i.test(scoringSource), false, "Scoring must not expose raw lines, secrets, or create player_stats.");
assert.equal(/hit lines|DEAD/i.test(scoringSource), false, "Scoring should read stored canonical kill_events, not re-parse hit lines.");

for (const snippet of [
  "refreshServerWarEventSnapshot",
  "LIMIT 64",
  "INSERT INTO server_war_score_snapshots",
  "getLatestServerWarStandings",
  "snapshotToStanding",
]) {
  assert.equal(snapshotSource.includes(snippet), true, `Expected snapshot helper to include ${snippet}.`);
}

for (const snippet of [
  "finalizeServerWarEvent",
  "server_war_event_not_ended",
  "INSERT INTO server_war_results",
  "ON CONFLICT(event_id, server_id) DO UPDATE",
  "INSERT OR IGNORE INTO server_trophies",
  "server_champion_titles",
  "alreadyFinalized",
]) {
  assert.equal(finalizeSource.includes(snippet), true, `Expected finalization helper to include ${snippet}.`);
}

assert.equal(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+player_profiles|CREATE TABLE IF NOT EXISTS player_stats/i.test(finalizeSource), false, "Finalization must not destructively mutate protected data.");
assert.match(publicApi, /fallback_reason: "server_wars_public_load_failed"/);
assert.match(publicDetailApi, /fallback_reason: "server_war_detail_load_failed"/);
assert.doesNotMatch(publicApi, /status:\s*503/);
assert.doesNotMatch(publicDetailApi, /status:\s*503/);

console.log("Server Wars scoring/snapshot/finalization tests passed.");
