import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseAdmLines } from "../functions/_lib/adm-parser";
import { classifyParsedBuildEvent } from "../functions/_lib/build-events";

const combatLines = readFixture("raw-bundle-combat-survival.ADM");
const buildLines = readFixture("raw-bundle-build-pve.ADM");

const parsed = parseAdmLines([...combatLines, ...buildLines]);
const creditedKills = parsed.filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
const hits = parsed.filter((event) => event.eventType?.startsWith("player_hit"));
const builds = parsed.map((event) => classifyParsedBuildEvent(event)).filter(Boolean);

assert.equal(creditedKills.length, 7);
assert.equal(hits.length, 13);
assert.equal(hits.filter((event) => event.hitZone === "Head" || event.hitZone === "Brain").length, 5);
assert.equal(parsed.filter((event) => event.eventType === "player_died_stats").length, 1);
assert.equal(parsed.filter((event) => event.eventType === "player_unconscious").length, 1);
assert.equal(parsed.filter((event) => event.eventType === "player_regained_consciousness").length, 1);
assert.equal(parsed.filter((event) => event.eventType === "playerlist_snapshot").length, 2);
assert.equal(parsed.filter((event) => event.eventType === "player_connected").length, 5);
assert.equal(parsed.filter((event) => event.eventType === "player_disconnected").length, 1);
assert.equal(builds.length, 18);
assert.equal(creditedKills.some((event) => event.weapon === "M70 Tundra" && event.distance === 57.2489), true);
assert.equal(creditedKills.some((event) => event.weapon === "KA-M" && event.distance === 1.29474), true);
assert.equal(hits.some((event) => event.hitZone === "Brain" && event.weapon === "DMR"), true);
assert.equal(builds.some((event) => event?.eventType === "built" && event.buildPart === "wall_base_up"), true);
assert.equal(builds.some((event) => event?.eventType === "built" && event.buildPart === "wall_metal_down"), true);
assert.equal(builds.some((event) => event?.eventType === "built" && event.buildPart === "wall_gate"), true);
assert.equal(builds.some((event) => event?.eventType === "built" && event.buildPart === "level_1_base"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "build_kit" && event.placedClass === "fencekit"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "build_kit" && event.placedClass === "watchtowerkit"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "storage"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "storage" && event.placedClass === "seachest"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "trap" && event.placedClass === "landminetrap"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "trap" && event.placedClass === "beartrap"), true);
assert.equal(builds.some((event) => event?.eventType === "placed" && event.category === "trap" && event.placedClass === "improvisedexplosive"), true);
assert.equal(builds.some((event) => event?.eventType === "repaired" && event.category === "maintenance"), true);
assert.equal(builds.some((event) => event?.eventType === "dismantled" && event.category === "raid"), true);
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
