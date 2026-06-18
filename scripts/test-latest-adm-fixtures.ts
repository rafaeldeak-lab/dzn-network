import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseAdmLines } from "../functions/_lib/adm-parser";

const fixtureRoot = "tests/fixtures/adm/recovery-june-2026/raw";

const expectedKillsByFile = new Map<string, number>([
  ["DayZServer_PS4_x64_2026-06-15_15-02-23.ADM", 9],
  ["DayZServer_PS4_x64_2026-06-15_16-02-40.ADM", 1],
  ["DayZServer_PS4_x64_2026-06-15_18-02-40.ADM", 5],
  ["DayZServer_PS4_x64_2026-06-17_16-01-50.ADM", 7],
  ["DayZServer_PS4_x64_2026-06-18_10-02-23.ADM", 3],
  ["DayZServer_PS4_x64_2026-06-18_12-02-41.ADM", 21],
]);

const backlogFixture = "DayZServer_PS4_x64_2026-06-18_17-02-14.ADM";

if (!existsSync(fixtureRoot)) {
  console.log("Latest ADM recovery raw fixture tests skipped: raw owner-supplied bundle is not present locally.");
  process.exit(0);
}

let totalKills = 0;
for (const [filename, expectedKills] of expectedKillsByFile.entries()) {
  const filePath = join(fixtureRoot, filename);
  assert.equal(existsSync(filePath), true, `${filename} must exist in ${fixtureRoot}`);
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const parsed = parseAdmLines(lines, { admDate: extractAdmDate(filename) ?? undefined });
  const creditedKills = parsed.filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
  const hitLines = parsed.filter((event) => String(event.eventType).startsWith("player_hit"));
  const environmentalDeaths = parsed.filter((event) => event.eventType === "player_died_stats" || event.eventType === "player_killed_environment");

  assert.equal(creditedKills.length, expectedKills, `${filename} credited kill count`);
  assert.equal(hitLines.some((event) => event.isCreditedKill), false, `${filename} hit lines must not be credited kills`);
  assert.equal(environmentalDeaths.some((event) => event.eventType === "player_killed"), false, `${filename} environmental deaths must not become PvP kills`);
  totalKills += creditedKills.length;
}

assert.equal(totalKills, 46);

const backlogFixturePath = join(fixtureRoot, backlogFixture);
if (existsSync(backlogFixturePath)) {
  const raw = readFileSync(backlogFixturePath, "utf8");
  const physicalLines = raw.split(/\r?\n/).length;
  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const parsed = parseAdmLines(lines, { admDate: extractAdmDate(backlogFixture) ?? undefined });
  const creditedKills = parsed.filter((event) => event.eventType === "player_killed" && event.isCreditedKill);
  const hitLines = parsed.filter((event) => event.eventType === "player_hit");
  const unknownAttackerHitLines = parsed.filter((event) => event.eventType === "player_hit_unknown_attacker");
  const connections = parsed.filter((event) => event.eventType === "player_connected");
  const disconnects = parsed.filter((event) => event.eventType === "player_disconnected");
  const playerlistSnapshots = parsed.filter((event) => event.eventType === "playerlist_snapshot");
  const environmentalDeaths = parsed.filter((event) => event.eventType === "player_died_stats" || event.eventType === "player_killed_environment");

  assert.equal(physicalLines === 323 || physicalLines === 324, true, `${backlogFixture} physical line count should only vary by trailing newline interpretation`);
  assert.equal(lines.length, 321, `${backlogFixture} non-empty line count`);
  assert.equal(creditedKills.length, 31, `${backlogFixture} credited kill count`);
  assert.equal(hitLines.length, 164, `${backlogFixture} player_hit line count`);
  assert.equal(unknownAttackerHitLines.length, 10, `${backlogFixture} unknown-attacker hit line count`);
  assert.equal(connections.length, 44, `${backlogFixture} connection count`);
  assert.equal(disconnects.length, 7, `${backlogFixture} disconnect count`);
  assert.equal(playerlistSnapshots.length, 4, `${backlogFixture} PlayerList snapshot count`);
  assert.equal(environmentalDeaths.length, 6, `${backlogFixture} environmental death count`);
  assert.equal(hitLines.some((event) => event.isCreditedKill), false, `${backlogFixture} hit lines must not be credited kills`);
  assert.equal(unknownAttackerHitLines.some((event) => event.isCreditedKill), false, `${backlogFixture} unknown-attacker hit lines must not be credited kills`);
  assert.equal(environmentalDeaths.some((event) => event.eventType === "player_killed"), false, `${backlogFixture} environmental deaths must not become PvP kills`);
  totalKills += creditedKills.length;
}

assert.equal(totalKills, existsSync(backlogFixturePath) ? 77 : 46);

console.log("Latest owner-supplied ADM fixture parser tests passed.", {
  files: expectedKillsByFile.size,
  backlogFixturePresent: existsSync(backlogFixturePath),
  totalKills,
});

function extractAdmDate(filename: string) {
  return filename.match(/DayZServer_PS4_x64_(\d{4}-\d{2}-\d{2})_/i)?.[1] ?? null;
}
