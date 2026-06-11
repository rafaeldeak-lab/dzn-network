import assert from "node:assert/strict";

import { positionToExplorationCell, summarizeMapExploration } from "../functions/_lib/map-exploration";
import { resolveDznMapConfig } from "../functions/_lib/map-configs";
import type { TravelPositionSample } from "../functions/_lib/travel-stats";

const chernarus = resolveDznMapConfig("ChernarusPlus");
assert.ok(chernarus, "ChernarusPlus map config should resolve");
assert.equal(resolveDznMapConfig("enoch")?.key, "livonia");
assert.equal(resolveDznMapConfig("Sakhal")?.key, "sakhal");

const cell = positionToExplorationCell(chernarus, 100, 100);
assert.ok(cell);
assert.equal(positionToExplorationCell(chernarus, -1, 100), null);

function sample(playerKey: string, x: number, y: number): TravelPositionSample {
  return {
    linkedServerId: "server-1",
    playerKey,
    playerName: playerKey === "a" ? "Alpha" : "Bravo",
    occurredAt: "2026-06-06T10:00:00.000Z",
    x,
    y,
    z: null,
    sourceEventType: "playerlist_snapshot",
  };
}

const summary = summarizeMapExploration("chernarus", [
  sample("a", 100, 100),
  sample("a", 100, 100),
  sample("a", 500, 500),
  sample("b", 900, 900),
  sample("b", 999999, 900),
], { overlayLimit: 2 });

assert.equal(summary.supported, true);
assert.equal(summary.mapKey, "chernarusplus");
assert.equal(summary.exploredCellsCount, 3);
assert.equal(summary.overlayCells.length, 2);
assert.equal(summary.activeExplorersCount, 2);
assert.equal(summary.topExplorerName, "Alpha");
assert.equal(summary.estimated, true);
assert.equal("x" in summary.overlayCells[0], false);
assert.equal("y" in summary.overlayCells[0], false);

const noOverlay = summarizeMapExploration("chernarus", [sample("a", 100, 100)], { overlayLimit: 0 });
assert.equal(noOverlay.overlayCells.length, 0);

const unsupported = summarizeMapExploration("unknown-map", [sample("a", 100, 100)]);
assert.equal(unsupported.supported, false);
assert.deepEqual(unsupported.overlayCells, []);

console.log("Map exploration privacy and grid tests passed.");
