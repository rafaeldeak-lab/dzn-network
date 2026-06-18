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

console.log("Latest owner-supplied ADM fixture parser tests passed.", {
  files: expectedKillsByFile.size,
  totalKills,
});

function extractAdmDate(filename: string) {
  return filename.match(/DayZServer_PS4_x64_(\d{4}-\d{2}-\d{2})_/i)?.[1] ?? null;
}
