import assert from "node:assert/strict";

import { computeTravelStats, type TravelPositionSample } from "../functions/_lib/travel-stats";

function sample(partial: Partial<TravelPositionSample> & Pick<TravelPositionSample, "occurredAt" | "x" | "y">): TravelPositionSample {
  return {
    linkedServerId: partial.linkedServerId ?? "server-1",
    playerKey: partial.playerKey ?? "player-1",
    playerName: partial.playerName ?? "Explorer",
    occurredAt: partial.occurredAt,
    x: partial.x,
    y: partial.y,
    z: partial.z ?? null,
    sourceEventType: partial.sourceEventType ?? "playerlist_snapshot",
  };
}

const result = computeTravelStats([
  sample({ occurredAt: "2026-06-06T10:00:00.000Z", x: 100, y: 100 }),
  sample({ occurredAt: "2026-06-06T10:01:00.000Z", x: 220, y: 100 }),
  sample({ occurredAt: "2026-06-06T10:02:00.000Z", x: 1500, y: 100 }),
  sample({ occurredAt: "2026-06-06T10:03:00.000Z", x: 9000, y: 9000 }),
  sample({ occurredAt: "2026-06-06T10:25:00.000Z", x: 9050, y: 9000 }),
  sample({ occurredAt: "2026-06-06T10:26:00.000Z", x: 9060, y: 9000 }),
]);

assert.equal(result.players.length, 1);
const player = result.players[0];
assert.ok(player, "expected player travel stats");
assert.equal(player.onFootDistanceM, 130);
assert.equal(player.fastTravelEstimatedDistanceM, 1280);
assert.ok(player.suspiciousSegmentsCount >= 1);
assert.ok(player.suspiciousDistanceIgnoredM > 0);
assert.equal(player.travelSessionsCount, 2);
assert.equal(result.servers[0]?.totalValidDistanceM, 1410);

const reconnectGuard = computeTravelStats([
  sample({ occurredAt: "2026-06-06T11:00:00.000Z", x: 0, y: 0, sourceEventType: "player_connected" }),
  sample({ occurredAt: "2026-06-06T11:02:00.000Z", x: 200, y: 0, sourceEventType: "player_disconnected" }),
  sample({ occurredAt: "2026-06-06T11:04:00.000Z", x: 9000, y: 0, sourceEventType: "player_connected" }),
  sample({ occurredAt: "2026-06-06T11:05:00.000Z", x: 9060, y: 0, sourceEventType: "playerlist_snapshot" }),
]);

assert.equal(reconnectGuard.players[0]?.totalValidDistanceM, 260);
assert.equal(reconnectGuard.players[0]?.travelSessionsCount, 2);

console.log("Travel stats guard tests passed.");
