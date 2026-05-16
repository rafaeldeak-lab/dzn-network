import assert from "node:assert/strict";

import { parseAdmLines } from "../functions/_lib/adm-parser";
import { calculateBuildScore, classifyParsedBuildEvent, summarizeBuildStats } from "../functions/_lib/build-events";

const admLines = [
  "AdminLog started on 2026-01-30 at 19:01:50",
  '19:58:57 | Player "Builder" (id=builder-1 pos=<22.3, 7892.5, 303.1>) placed Fence Kit<FenceKit>',
  '19:59:30 | Player "Builder" (id=builder-1 pos=<22.4, 7891.1, 303.0>)Built base on Fence with Shovel',
  '20:00:27 | Player "Builder" (id=builder-1 pos=<22.3, 7891.3, 303.1>)Built wall_base_up on Fence with Hatchet',
  '20:01:27 | Player "Builder" (id=builder-1 pos=<22.4, 7891.5, 303.1>)Built wall_gate on Gate with Pliers',
  '20:02:27 | Player "Builder" (id=builder-1 pos=<22.4, 7891.5, 303.1>) placed Wooden Crate<WoodenCrate>',
  '20:03:27 | Player "Builder" (id=builder-1 pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Green>',
  '20:04:27 | Player "Builder" (id=builder-1 pos=<22.4, 7891.5, 303.1>) placed Land Mine<LandMineTrap>',
  '20:05:27 | Player "Builder" (id=builder-1 pos=<22.4, 7891.5, 303.1>) placed Fireplace',
];

const parsed = parseAdmLines(admLines);
const buildEvents = parsed
  .map((event) => classifyParsedBuildEvent(event))
  .filter((event): event is NonNullable<typeof event> => Boolean(event));

assert.equal(buildEvents.length, 7);
assert.equal(buildEvents[0]?.eventType, "placed");
assert.equal(buildEvents[0]?.placedObject, "Fence Kit");
assert.equal(buildEvents[0]?.placedClass, "fencekit");
assert.equal(buildEvents[0]?.category, "build_kit");
assert.equal(buildEvents[1]?.eventType, "built");
assert.equal(buildEvents[1]?.buildPart, "base");
assert.equal(buildEvents[1]?.score, 12);
assert.equal(buildEvents[2]?.buildPart, "wall_base_up");
assert.equal(buildEvents[3]?.buildPart, "wall_gate");
assert.equal(buildEvents[3]?.score, 15);
assert.equal(buildEvents[4]?.category, "storage");
assert.equal(buildEvents[5]?.category, "storage");
assert.equal(buildEvents[6]?.category, "trap");

const stats = summarizeBuildStats(buildEvents);
assert.deepEqual(stats, {
  structuresBuilt: 3,
  buildItemsPlaced: 1,
  storageItemsPlaced: 2,
  trapsPlaced: 1,
  buildScore: 49,
});

assert.equal(
  calculateBuildScore({
    structuresBuilt: 3,
    buildItemsPlaced: 1,
    storageItemsPlaced: 2,
    trapsPlaced: 1,
    weightedStructurePoints: 37,
  }),
  49,
);

const serviceId = "111";
const file = "DayZServer_PS4_x64_2026-01-30_19-01-50.ADM";
const lineNumber = 3;
const dedupeKey = `${serviceId}:${file}:${lineNumber}`;
assert.equal(dedupeKey, "111:DayZServer_PS4_x64_2026-01-30_19-01-50.ADM:3");

const pandoraEvents = [{ linkedServerId: "pandora", event: buildEvents[1] }];
const nuketownEvents = [{ linkedServerId: "nuketown", event: buildEvents[2] }];
assert.equal(pandoraEvents.filter((row) => row.linkedServerId === "pandora").length, 1);
assert.equal(pandoraEvents.some((row) => row.linkedServerId === "nuketown"), false);
assert.equal(nuketownEvents.some((row) => row.linkedServerId === "pandora"), false);

console.log("Build parser and scoring tests passed.");
