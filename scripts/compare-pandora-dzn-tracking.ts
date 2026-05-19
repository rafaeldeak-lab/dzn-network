import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseAdmLines, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { buildAdmImportDebugReport } from "../functions/_lib/adm-sync";

type PandoraKill = {
  time: string | null;
  victim: string;
  killer: string;
  weapon: string;
  distance: number | null;
  rawLine: string;
};

type PandoraComparison = {
  pvpKills: PandoraKill[];
  suicides: string[];
  uncreditedDeaths: string[];
  playerListCount: number | null;
  playerListEntries: string[];
  joins: string[];
  disconnects: string[];
  deadHits: string[];
};

type DznComparison = {
  pvpKills: ParsedAdmEvent[];
  suicides: ParsedAdmEvent[];
  uncreditedDeaths: ParsedAdmEvent[];
  playerListCount: number | null;
  playerListEntries: ParsedAdmEvent[];
  joins: ParsedAdmEvent[];
  disconnects: ParsedAdmEvent[];
  deadHits: ParsedAdmEvent[];
};

const OLD_BOT_ROOT = "C:\\Users\\rafae\\OneDrive\\Desktop\\Pandora Bot";
const QUESTPACK_PATH = path.join(OLD_BOT_ROOT, "questpacks", "PandoraBot_Full_ConsoleQuestPack_100.json");
const FIXTURE_PATH = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "DayZServer_PS4_x64_2026-05-19_16-01-55.ADM",
);

const TIME_PREFIX = /^\s*(\d{2}:\d{2}:\d{2})\s*\|\s*/;
const PLAYERLIST_COUNT = /#####\s*PlayerList\s+log:\s*(\d+)\s*players/i;
const PLAYERLIST_ENTRY = /Player\s+"([^"]+)"[^\r\n]*\bid=/i;
const JOIN = /Player\s+"([^"]+)"[^\r\n]*(?:is\s+)?\bconnected\b/i;
const LEAVE = /Player\s+"([^"]+)"[^\r\n]*\b(?:has been disconnected|disconnected|left)\b/i;
const DEAD_HIT = /\(DEAD\)[^\r\n]*\]\s*hit by\s+Player\s+"/i;
const SUICIDE = /Player\s+"([^"]+)"[^\r\n]*\bcommitted suicide\b/i;
const DIED_STATS = /Player\s+"([^"]+)"\s+\(DEAD\)[^\r\n]*\bdied\. Stats>/i;

function compileQuestpackRegex(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}

function readPandoraKillRegexes() {
  if (!existsSync(QUESTPACK_PATH)) {
    throw new Error(`Pandora quest pack not found: ${QUESTPACK_PATH}`);
  }

  const raw = JSON.parse(readFileSync(QUESTPACK_PATH, "utf8")) as {
    log_parsing?: {
      player_kill_weapon_regex?: string;
      player_kill_victim_regex?: string;
    };
  };

  const killPattern = raw.log_parsing?.player_kill_weapon_regex;
  const victimPattern = raw.log_parsing?.player_kill_victim_regex;
  if (!killPattern || !victimPattern) {
    throw new Error("Pandora quest pack is missing player kill regex patterns.");
  }

  return {
    kill: compileQuestpackRegex(killPattern),
    victim: compileQuestpackRegex(victimPattern),
  };
}

function lineTime(line: string): string | null {
  return TIME_PREFIX.exec(line)?.[1] ?? null;
}

function compareSignatureFromPandora(kill: PandoraKill): string {
  return [kill.time ?? "", kill.killer, kill.victim, kill.weapon, kill.distance ?? ""].join("|").toLowerCase();
}

function compareSignatureFromDzn(event: ParsedAdmEvent): string {
  const time = event.occurredAt?.slice(11, 19) ?? "";
  return [time, event.killerName ?? "", event.victimName ?? "", event.weapon ?? "", event.distance ?? ""].join("|").toLowerCase();
}

function parseWithPandoraLogic(lines: string[]): PandoraComparison {
  const regexes = readPandoraKillRegexes();
  const pvpKills: PandoraKill[] = [];
  const suicides: string[] = [];
  const uncreditedDeaths: string[] = [];
  const playerListEntries: string[] = [];
  const joins: string[] = [];
  const disconnects: string[] = [];
  const deadHits: string[] = [];
  let playerListCount: number | null = null;
  let inPlayerListBlock = false;

  for (const line of lines) {
    const kill = regexes.kill.exec(line);
    if (kill?.groups) {
      const victim = regexes.victim.exec(line)?.groups?.victim?.trim() ?? "";
      const killer = kill.groups.killer?.trim() ?? "";
      const weapon = kill.groups.weapon?.trim() ?? "";
      const distanceRaw = kill.groups.distance?.trim() ?? "";
      const distance = distanceRaw ? Number(distanceRaw) : null;
      pvpKills.push({
        time: lineTime(line),
        victim,
        killer,
        weapon,
        distance: Number.isFinite(distance) ? distance : null,
        rawLine: line,
      });
      continue;
    }

    const playerList = PLAYERLIST_COUNT.exec(line);
    if (playerList) {
      playerListCount = Number(playerList[1]);
      inPlayerListBlock = true;
      continue;
    }

    if (inPlayerListBlock && /#####/.test(line)) {
      continue;
    }

    const entry = inPlayerListBlock ? PLAYERLIST_ENTRY.exec(line) : null;
    if (entry) {
      playerListEntries.push(entry[1].trim());
      if (playerListCount !== null && playerListEntries.length >= playerListCount) {
        inPlayerListBlock = false;
      }
      continue;
    }
    if (inPlayerListBlock) inPlayerListBlock = false;

    const join = JOIN.exec(line);
    if (join) joins.push(join[1].trim());

    const leave = LEAVE.exec(line);
    if (leave) disconnects.push(leave[1].trim());

    const suicide = SUICIDE.exec(line);
    if (suicide) suicides.push(suicide[1].trim());

    const diedStats = DIED_STATS.exec(line);
    if (diedStats) uncreditedDeaths.push(diedStats[1].trim());

    if (DEAD_HIT.test(line)) deadHits.push(line);
  }

  return {
    pvpKills,
    suicides,
    uncreditedDeaths,
    playerListCount,
    playerListEntries,
    joins,
    disconnects,
    deadHits,
  };
}

function parseWithDznLogic(lines: string[]): DznComparison {
  const events = parseAdmLines(lines, { admDate: "2026-05-19" });
  const snapshot = events.find((event) => event.eventType === "playerlist_snapshot");
  return {
    pvpKills: events.filter((event) => event.eventType === "player_killed" && event.isCreditedKill),
    suicides: events.filter((event) => event.eventType === "player_suicide"),
    uncreditedDeaths: events.filter((event) => event.eventType === "player_died_stats"),
    playerListCount: snapshot?.playerCount ?? null,
    playerListEntries: events.filter((event) => event.eventType === "playerlist_entry"),
    joins: events.filter((event) => event.eventType === "player_connected"),
    disconnects: events.filter((event) => event.eventType === "player_disconnected"),
    deadHits: events.filter((event) => event.eventType === "player_hit" && event.victimDead && !event.isCreditedKill),
  };
}

function missingPandoraKillsFromDzn(pandora: PandoraComparison, dzn: DznComparison) {
  const dznSignatures = new Set(dzn.pvpKills.map(compareSignatureFromDzn));
  return pandora.pvpKills.filter((kill) => !dznSignatures.has(compareSignatureFromPandora(kill)));
}

function missingDznKillsFromPandora(pandora: PandoraComparison, dzn: DznComparison) {
  const pandoraSignatures = new Set(pandora.pvpKills.map(compareSignatureFromPandora));
  return dzn.pvpKills.filter((event) => !pandoraSignatures.has(compareSignatureFromDzn(event)));
}

function countBy<T extends string | null>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = value || "unknown";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function main() {
  if (!existsSync(OLD_BOT_ROOT)) {
    throw new Error(`Old Pandora Bot path is not accessible: ${OLD_BOT_ROOT}`);
  }
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`ADM fixture not found: ${FIXTURE_PATH}`);
  }

  const lines = readFileSync(FIXTURE_PATH, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const pandora = parseWithPandoraLogic(lines);
  const dzn = parseWithDznLogic(lines);
  const report = buildAdmImportDebugReport(lines, {
    admFileName: "DayZServer_PS4_x64_2026-05-19_16-01-55.ADM",
  });

  assert.equal(dzn.pvpKills.length, 10);
  assert.equal(dzn.suicides.length, 2);
  assert.equal(dzn.uncreditedDeaths.length, 1);
  assert.deepEqual(countBy(dzn.pvpKills.map((event) => event.killerName)), {
    mustard_coffer74: 5,
    Uractuallybadzzz: 4,
    "xAKA-MINI_KickAs": 1,
  });

  const missingFromDzn = missingPandoraKillsFromDzn(pandora, dzn);
  const missingFromPandora = missingDznKillsFromPandora(pandora, dzn);

  console.log("Pandora vs DZN ADM tracking comparison");
  console.log("======================================");
  console.log(`Old Pandora path accessible: ${existsSync(OLD_BOT_ROOT) ? "yes" : "no"}`);
  console.log(`Fixture lines: ${lines.length}`);
  console.log("");
  console.log("Pandora-compatible parser");
  console.log("-------------------------");
  console.log(`PvP kills: ${pandora.pvpKills.length}`);
  console.log(`Suicides detected by comparison shim: ${pandora.suicides.length}`);
  console.log(`Uncredited deaths detected by comparison shim: ${pandora.uncreditedDeaths.length}`);
  console.log(`PlayerList count: ${pandora.playerListCount ?? "none"}`);
  console.log(`PlayerList entries: ${pandora.playerListEntries.length}`);
  console.log(`Joins: ${pandora.joins.length}`);
  console.log(`Disconnects: ${pandora.disconnects.length}`);
  console.log(`DEAD hit lines: ${pandora.deadHits.length}`);
  console.log(`Killer totals: ${JSON.stringify(countBy(pandora.pvpKills.map((kill) => kill.killer)))}`);
  console.log("");
  console.log("DZN parser");
  console.log("----------");
  console.log(`PvP kills: ${dzn.pvpKills.length}`);
  console.log(`Suicides: ${dzn.suicides.length}`);
  console.log(`Uncredited deaths: ${dzn.uncreditedDeaths.length}`);
  console.log(`PlayerList count: ${dzn.playerListCount ?? "none"}`);
  console.log(`PlayerList entries: ${dzn.playerListEntries.length}`);
  console.log(`Joins: ${dzn.joins.length}`);
  console.log(`Disconnects: ${dzn.disconnects.length}`);
  console.log(`DEAD hit lines skipped as kills: ${dzn.deadHits.length}`);
  console.log(`Killer totals: ${JSON.stringify(countBy(dzn.pvpKills.map((event) => event.killerName)))}`);
  console.log("");
  console.log("Differences");
  console.log("-----------");
  console.log(`Missing from DZN: ${missingFromDzn.length}`);
  console.log(`Missing from Pandora: ${missingFromPandora.length}`);
  console.log(`Suicide difference: Pandora shim ${pandora.suicides.length}, DZN ${dzn.suicides.length}`);
  console.log(`Uncredited death difference: Pandora shim ${pandora.uncreditedDeaths.length}, DZN ${dzn.uncreditedDeaths.length}`);
  console.log(`PlayerList entry difference: Pandora shim ${pandora.playerListEntries.length}, DZN ${dzn.playerListEntries.length}`);
  console.log("");
  console.log("DZN import debug report");
  console.log("-----------------------");
  console.log(JSON.stringify(report, null, 2));
}

main();
