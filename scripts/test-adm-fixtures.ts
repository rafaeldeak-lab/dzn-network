import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseAdmLines } from "../functions/_lib/adm-parser";
import { classifyParsedBuildEvent } from "../functions/_lib/build-events";

const combatLines = readFixture("advanced-combat-from-9724824-log-1.ADM");
const buildLines = readFixture("advanced-build-from-17428528-logs.ADM");

const parsed = parseAdmLines([...combatLines, ...buildLines]);
const creditedKills = parsed.filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
const hits = parsed.filter((event) => event.eventType?.startsWith("player_hit"));
const builds = parsed.map((event) => classifyParsedBuildEvent(event)).filter(Boolean);

assert.equal(creditedKills.length, 5);
assert.equal(hits.length, 9);
assert.equal(hits.filter((event) => event.hitZone === "Head" || event.hitZone === "Brain").length, 4);
assert.equal(parsed.filter((event) => event.eventType === "playerlist_snapshot").length, 1);
assert.equal(parsed.filter((event) => event.eventType === "player_connected").length, 3);
assert.equal(parsed.filter((event) => event.eventType === "player_disconnected").length, 2);
assert.equal(builds.length, 23);
assert.equal(builds.some((event) => event?.eventType === "built" && event.buildPart === "wall_base_up"), true);
assert.equal(builds.some((event) => event?.eventType === "built" && event.buildPart === "level_1_base"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "build_kit" && event.placedClass === "fencekit"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "storage"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "trap"), true);
assert.equal(builds.some((event) => event?.eventType === "repaired" && event.category === "maintenance"), true);
assert.equal(builds.some((event) => event?.eventType === "mounted" && event.category === "defence"), true);
assert.equal(builds.some((event) => event?.eventType === "unmounted" && event.category === "defence"), true);
assert.equal(builds.some((event) => event?.eventType === "destroyed" && event.category === "raid"), true);
assert.equal(builds.some((event) => event?.eventType === "folded"), true);

console.log("Raw-derived trimmed ADM fixture parser tests passed.");

function readFixture(name: string) {
  return readFileSync(`tests/fixtures/adm/${name}`, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}
