import assert from "node:assert/strict";
import { HUB_OPERATIONS, buildOperationsRecord, operationForGame } from "../lib/games-operations";
import { HUB_GAME_IDS, type HubSummary } from "../lib/games-hub";

const summary: HubSummary = {
  username: "Test operator", xp: 900, parts: 20, streak: 4, assemblies: 2, today: ["recon"], resetAt: Date.now() + 60_000,
  challenges: { dailyRewards: 1, weeklyXp: 520, streak: 4, weeklyExpiresAt: Date.now() + 60_000 },
  history: [{ kind: "minefield", xp: 50, parts: 1, created_at: Date.now() }],
};

const seen = new Set(HUB_GAME_IDS.map((id) => HUB_OPERATIONS[id].code));
assert.equal(seen.size, HUB_GAME_IDS.length, "each live mode must retain a distinct operations identifier");
for (const id of HUB_GAME_IDS) {
  const operation = operationForGame(id);
  assert.equal(operation.id, id);
  assert.ok(operation.name.length > 2);
  assert.ok(operation.objective.length > 12);
  assert.ok(operation.pressure.length > 3);
}

const record = buildOperationsRecord(summary);
assert.deepEqual(record.clearance, { level: 4, title: "Watch Commander", floorXp: 900, nextXp: 1800 });
assert.equal(record.clearanceProgress, 0);
assert.equal(record.recentOutcomes, 1);
assert.equal(record.dailyRewards, 1);
assert.equal(record.weeklyXp, 520);
assert.equal(record.streak, 4);
assert.equal(record.assemblies, 2);
assert.equal(buildOperationsRecord({ ...summary, xp: 10_000 }).clearanceProgress, 100);

console.log("Games operations tests passed");
