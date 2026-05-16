/**
 * ONE-TIME LOCAL SERVER SCOPE REPAIR SCRIPT
 *
 * This script is not part of normal DZN sync.
 * It only runs when manually executed from the terminal.
 * It removes proven cross-server event rows from one linked server,
 * optionally imports that server's own ADM kills, rebuilds totals, then exits.
 *
 * Normal scheduled/manual ADM sync continues as usual afterwards.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { parseAdmLine, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { decryptToken } from "../functions/_lib/crypto";
import { fetchReadableNitradoAdmLines } from "../functions/_lib/nitrado";

const DATABASE_NAME = "dzn_network_db";
const LOCAL_TOKEN_FILE = ".local-nitrado-token";

type Mode = "dry-run" | "apply";
type ApplyPhase = "REMOVE_FOREIGN" | "ADM_INSERTS" | "REBUILD_TARGET" | "REBUILD_AFFECTED";
type TokenSource = "environment/direct" | "stored" | "local file";

type LinkedServerRow = {
  id: string;
  user_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  server_name: string | null;
  display_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ServerSummary = {
  kill_events: number;
  player_events: number;
  raw_events: number;
  player_profiles: number;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
};

type KillRow = {
  id: string;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  adm_file: string | null;
  line_number: number | null;
  killer_id: string | null;
  killer_name: string | null;
  victim_id: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
  raw_line: string | null;
};

type PlayerEventRow = {
  id: string;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  adm_file: string | null;
  line_number: number | null;
  player_id: string | null;
  player_name: string | null;
  event_type: string | null;
  occurred_at: string | null;
  created_at: string | null;
  raw_line: string | null;
};

type RawEventRow = {
  id: string;
  linked_server_id: string;
  adm_file: string | null;
  line_number: number | null;
  raw_line: string | null;
};

type ProfileRow = {
  id: string;
  player_name: string;
  player_id: string | null;
};

type KillCandidate = {
  parsed: ParsedAdmEvent;
  lineNumber: number;
  admFile: string;
  primaryId: string;
  fallbackKey: string;
};

type ForeignKill = {
  target: KillRow;
  matched: KillRow;
  reason: string;
};

type ForeignPlayerEvent = {
  target: PlayerEventRow;
  matched: PlayerEventRow | null;
  reason: string;
};

type AdmImportPlan = {
  source: "none" | "local" | "nitrado";
  requestedAdmFile: string | null;
  actualAdmFile: string | null;
  linesScanned: number;
  killCandidates: KillCandidate[];
  missingKills: KillCandidate[];
  duplicatesSkipped: number;
  foreignSkipped: number;
  tokenSource: TokenSource | null;
  error: string | null;
};

loadEnvFiles();

const args = parseArgs(process.argv.slice(2));
const mode = resolveMode(args);
const requestedSlug = stringArg(args, "slug") ?? fail("Missing --slug. Example: npm run repair:server-scope -- --slug pandora-dayz --dry-run");
const requestedAdmFile = stringArg(args, "adm-file");
const localAdmPath = stringArg(args, "adm-local");

main().catch((error) => {
  console.error("Server scope repair failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const target = await resolveLinkedServerBySlug(requestedSlug);
  if (!target) fail(`No live linked server found for slug: ${requestedSlug}`);

  const targetSummary = await summarizeServer(target.id);
  const [allKills, allPlayerEvents, targetRawEvents] = await Promise.all([
    getAllKillRows(),
    getAllPlayerEventRows(),
    getRawEvents(target.id),
  ]);

  const targetKills = allKills.filter((row) => row.linked_server_id === target.id);
  const otherKills = allKills.filter((row) => row.linked_server_id !== target.id);
  const targetPlayerEvents = allPlayerEvents.filter((row) => row.linked_server_id === target.id);
  const otherPlayerEvents = allPlayerEvents.filter((row) => row.linked_server_id !== target.id);

  const foreignKills = findForeignKills(targetKills, otherKills);
  const foreignFiles = new Set(foreignKills.map((row) => row.target.adm_file).filter(isNonEmptyString));
  const foreignPlayerKeys = collectForeignPlayerKeys(foreignKills);
  const foreignPlayerEvents = findForeignPlayerEvents(targetPlayerEvents, otherPlayerEvents, foreignFiles, foreignPlayerKeys);
  const foreignRawEvents = targetRawEvents.filter((row) => row.adm_file && foreignFiles.has(row.adm_file));
  const affectedServerIds = uniqueStrings([
    ...foreignKills.map((row) => row.matched.linked_server_id),
    ...foreignPlayerEvents.map((row) => row.matched?.linked_server_id ?? null),
  ]).filter((id) => id !== target.id);
  const admImport = await buildAdmImportPlan(target, targetKills, otherKills);

  printPlan({
    target,
    targetSummary,
    foreignKills,
    foreignPlayerEvents,
    foreignRawEvents,
    affectedServerIds,
    admImport,
  });

  if (mode === "dry-run") {
    console.log("");
    console.log("No database changes made.");
    return;
  }

  const hasChanges =
    foreignKills.length > 0 ||
    foreignPlayerEvents.length > 0 ||
    foreignRawEvents.length > 0 ||
    admImport.missingKills.length > 0;

  if (!hasChanges) {
    await runSqlPhase(buildRebuildSql(target.id), "REBUILD_TARGET");
    console.log("");
    console.log("No proven foreign rows or missing ADM kills found.");
    console.log("Database already up to date.");
    return;
  }

  await runSqlPhase(buildRemoveForeignSql(foreignKills, foreignPlayerEvents, foreignRawEvents), "REMOVE_FOREIGN");
  if (admImport.missingKills.length) {
    await runSqlPhase(buildAdmInsertSql(target.id, admImport.missingKills, await getProfiles(target.id)), "ADM_INSERTS");
  }
  await runSqlPhase(buildRebuildSql(target.id), "REBUILD_TARGET");
  for (const serverId of affectedServerIds) {
    await runSqlPhase(buildRebuildSql(serverId), "REBUILD_AFFECTED");
  }

  const repaired = await summarizeServer(target.id);
  console.log("");
  console.log("DZN SERVER SCOPE REPAIR COMPLETE");
  console.log("");
  console.log(`Slug: ${target.public_slug ?? requestedSlug}`);
  console.log(`Server: ${serverDisplayName(target)}`);
  console.log(`Linked server ID: ${target.id}`);
  console.log(`Service ID: ${target.nitrado_service_id ?? "unknown"}`);
  console.log(`Foreign kill rows removed: ${foreignKills.length}`);
  console.log(`Foreign player event rows removed: ${foreignPlayerEvents.length}`);
  console.log(`Foreign raw ADM rows removed: ${foreignRawEvents.length}`);
  console.log(`New server-owned ADM kills inserted: ${admImport.missingKills.length}`);
  console.log(`Server total kills: ${repaired.total_kills}`);
  console.log(`Server total deaths: ${repaired.total_deaths}`);
  console.log(`Unique players: ${repaired.unique_players}`);
  console.log("Normal ADM auto-sync is unchanged.");
}

function printPlan(input: {
  target: LinkedServerRow;
  targetSummary: ServerSummary;
  foreignKills: ForeignKill[];
  foreignPlayerEvents: ForeignPlayerEvent[];
  foreignRawEvents: RawEventRow[];
  affectedServerIds: string[];
  admImport: AdmImportPlan;
}) {
  const expectedKills = Math.max(0, input.targetSummary.kill_events - input.foreignKills.length + input.admImport.missingKills.length);
  console.log(mode === "dry-run" ? "DZN server scope repair dry run." : "DZN server scope repair apply.");
  console.log("");
  console.log(`Slug: ${input.target.public_slug ?? requestedSlug}`);
  console.log(`Server: ${serverDisplayName(input.target)}`);
  console.log(`Linked server ID: ${input.target.id}`);
  console.log(`Service ID: ${input.target.nitrado_service_id ?? "unknown"}`);
  console.log("");
  console.log(`Kill events currently attached: ${input.targetSummary.kill_events}`);
  console.log(`Player events currently attached: ${input.targetSummary.player_events}`);
  console.log(`Raw ADM events currently attached: ${input.targetSummary.raw_events}`);
  console.log(`Player profiles currently attached: ${input.targetSummary.player_profiles}`);
  console.log(`Current server total kills: ${input.targetSummary.total_kills}`);
  console.log(`Current server total deaths: ${input.targetSummary.total_deaths}`);
  console.log(`Current unique players: ${input.targetSummary.unique_players}`);
  console.log("");
  console.log(`Suspected/proven foreign kill_events: ${input.foreignKills.length}`);
  console.log(`Suspected/proven foreign player_events: ${input.foreignPlayerEvents.length}`);
  console.log(`Suspected/proven foreign raw ADM rows: ${input.foreignRawEvents.length}`);
  console.log(`Rows that would be moved: 0`);
  console.log(`Rows that would be removed: ${input.foreignKills.length + input.foreignPlayerEvents.length + input.foreignRawEvents.length}`);
  if (input.foreignKills.length) {
    console.table(input.foreignKills.slice(0, 12).map((item) => ({
      kill_id: item.target.id,
      adm_file: item.target.adm_file,
      line: item.target.line_number,
      killer: item.target.killer_name,
      victim: item.target.victim_name,
      matched_server: item.matched.server_name,
      matched_slug: item.matched.public_slug,
      reason: item.reason,
    })));
  }
  console.log("");
  console.log(`ADM import source: ${input.admImport.source}`);
  console.log(`Requested ADM file: ${input.admImport.requestedAdmFile ?? "none"}`);
  console.log(`Actual ADM file used: ${input.admImport.actualAdmFile ?? "none"}`);
  console.log(`Lines scanned: ${input.admImport.linesScanned}`);
  console.log(`Kill lines found: ${input.admImport.killCandidates.length}`);
  console.log(`Existing target kills skipped: ${input.admImport.duplicatesSkipped}`);
  console.log(`Cross-server ADM candidates skipped: ${input.admImport.foreignSkipped}`);
  console.log(`Missing server-owned kill_events to insert: ${input.admImport.missingKills.length}`);
  if (input.admImport.error) console.log(`ADM import note: ${input.admImport.error}`);
  console.log("");
  console.log(`Expected ${serverDisplayName(input.target)} totals after repair:`);
  console.log(`- Kills: ${expectedKills}`);
  console.log(`- Foreign rows removed from this profile: ${input.foreignKills.length + input.foreignPlayerEvents.length + input.foreignRawEvents.length}`);
  if (input.affectedServerIds.length) {
    console.log(`Affected other server totals to rebuild: ${input.affectedServerIds.join(", ")}`);
  }
}

async function resolveLinkedServerBySlug(slug: string) {
  const normalized = sanitizeSlug(slug);
  const rows = await d1Query<LinkedServerRow>(
    `SELECT *
     FROM linked_servers
     WHERE lower(status) = 'live'
       AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
     ORDER BY updated_at DESC, created_at DESC`,
  );
  const exact = rows.find((row) => sanitizeSlug(row.public_slug) === normalized);
  if (exact) return exact;
  return rows.find((row) => slugCandidates(row.public_slug, row.display_name, row.hostname, row.server_name, row.nitrado_service_name).has(normalized)) ?? null;
}

async function summarizeServer(linkedServerId: string): Promise<ServerSummary> {
  const rows = await d1Query<Record<string, unknown>>(
    `SELECT
       (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(linkedServerId)}) AS kill_events,
       (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(linkedServerId)}) AS player_events,
       (SELECT COUNT(*) FROM adm_raw_events WHERE linked_server_id = ${sqlString(linkedServerId)}) AS raw_events,
       (SELECT COUNT(*) FROM player_profiles WHERE linked_server_id = ${sqlString(linkedServerId)}) AS player_profiles,
       COALESCE((SELECT total_kills FROM server_stats WHERE linked_server_id = ${sqlString(linkedServerId)}), 0) AS total_kills,
       COALESCE((SELECT total_deaths FROM server_stats WHERE linked_server_id = ${sqlString(linkedServerId)}), 0) AS total_deaths,
       COALESCE((SELECT total_joins FROM server_stats WHERE linked_server_id = ${sqlString(linkedServerId)}), 0) AS total_joins,
       COALESCE((SELECT total_disconnects FROM server_stats WHERE linked_server_id = ${sqlString(linkedServerId)}), 0) AS total_disconnects,
       COALESCE((SELECT unique_players FROM server_stats WHERE linked_server_id = ${sqlString(linkedServerId)}), 0) AS unique_players`,
  );
  const row = rows[0] ?? {};
  return {
    kill_events: numberOrZero(row.kill_events),
    player_events: numberOrZero(row.player_events),
    raw_events: numberOrZero(row.raw_events),
    player_profiles: numberOrZero(row.player_profiles),
    total_kills: numberOrZero(row.total_kills),
    total_deaths: numberOrZero(row.total_deaths),
    total_joins: numberOrZero(row.total_joins),
    total_disconnects: numberOrZero(row.total_disconnects),
    unique_players: numberOrZero(row.unique_players),
  };
}

async function getAllKillRows() {
  return d1Query<KillRow>(
    `SELECT
       kill_events.id,
       kill_events.linked_server_id,
       COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
       linked_servers.public_slug,
       linked_servers.nitrado_service_id,
       kill_events.adm_file,
       kill_events.line_number,
       kill_events.killer_id,
       kill_events.killer_name,
       kill_events.victim_id,
       kill_events.victim_name,
       kill_events.weapon,
       kill_events.distance,
       kill_events.occurred_at,
       kill_events.created_at,
       kill_events.raw_line
     FROM kill_events
     INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
     WHERE lower(linked_servers.status) = 'live'
       AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
  );
}

async function getAllPlayerEventRows() {
  return d1Query<PlayerEventRow>(
    `SELECT
       player_events.id,
       player_events.linked_server_id,
       COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
       linked_servers.public_slug,
       linked_servers.nitrado_service_id,
       player_events.adm_file,
       player_events.line_number,
       player_events.player_id,
       player_events.player_name,
       player_events.event_type,
       player_events.occurred_at,
       player_events.created_at,
       player_events.raw_line
     FROM player_events
     INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
     WHERE lower(linked_servers.status) = 'live'
       AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
  );
}

async function getRawEvents(linkedServerId: string) {
  return d1Query<RawEventRow>(
    `SELECT id, linked_server_id, adm_file, line_number, raw_line
     FROM adm_raw_events
     WHERE linked_server_id = ${sqlString(linkedServerId)}`,
  );
}

function findForeignKills(targetKills: KillRow[], otherKills: KillRow[]) {
  const byFallback = new Map<string, KillRow[]>();
  const byRawLine = new Map<string, KillRow[]>();
  for (const row of otherKills) {
    addToMap(byFallback, killFallbackKey(row), row);
    if (row.raw_line) addToMap(byRawLine, normalizeRawLine(row.raw_line), row);
  }

  const foreign: ForeignKill[] = [];
  for (const row of targetKills) {
    const rawMatches = row.raw_line ? byRawLine.get(normalizeRawLine(row.raw_line)) ?? [] : [];
    const fallbackMatches = byFallback.get(killFallbackKey(row)) ?? [];
    const match = rawMatches[0] ?? fallbackMatches[0] ?? null;
    if (!match) continue;
    foreign.push({
      target: row,
      matched: match,
      reason: rawMatches[0] ? "Exact raw ADM kill also exists on another linked server" : "Same kill identity exists on another linked server",
    });
  }
  return foreign;
}

function findForeignPlayerEvents(
  targetEvents: PlayerEventRow[],
  otherEvents: PlayerEventRow[],
  foreignFiles: Set<string>,
  foreignPlayerKeys: Set<string>,
) {
  const byRawLine = new Map<string, PlayerEventRow[]>();
  const byFallback = new Map<string, PlayerEventRow[]>();
  for (const row of otherEvents) {
    if (row.raw_line) addToMap(byRawLine, normalizeRawLine(row.raw_line), row);
    addToMap(byFallback, playerEventFallbackKey(row), row);
  }

  const foreign: ForeignPlayerEvent[] = [];
  for (const row of targetEvents) {
    const rawMatch = row.raw_line ? byRawLine.get(normalizeRawLine(row.raw_line))?.[0] ?? null : null;
    if (rawMatch) {
      foreign.push({ target: row, matched: rawMatch, reason: "Exact raw ADM player event also exists on another linked server" });
      continue;
    }
    const fallbackMatch = byFallback.get(playerEventFallbackKey(row))?.[0] ?? null;
    if (fallbackMatch) {
      foreign.push({ target: row, matched: fallbackMatch, reason: "Same player event identity exists on another linked server" });
      continue;
    }
    const playerKey = playerIdentity(row.player_id, row.player_name);
    if (row.adm_file && foreignFiles.has(row.adm_file) && playerKey && foreignPlayerKeys.has(playerKey)) {
      foreign.push({ target: row, matched: null, reason: "Player event belongs to an ADM file proven foreign by duplicate kills" });
    }
  }
  return foreign;
}

function collectForeignPlayerKeys(rows: ForeignKill[]) {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of [
      playerIdentity(row.target.killer_id, row.target.killer_name),
      playerIdentity(row.target.victim_id, row.target.victim_name),
    ]) {
      if (key) keys.add(key);
    }
  }
  return keys;
}

async function buildAdmImportPlan(target: LinkedServerRow, targetKills: KillRow[], otherKills: KillRow[]): Promise<AdmImportPlan> {
  if (!requestedAdmFile && !localAdmPath) {
    return emptyAdmImportPlan();
  }

  let source: "local" | "nitrado";
  let lines: string[];
  let actualAdmFile: string;
  let tokenSource: TokenSource | null = null;

  if (localAdmPath) {
    if (!existsSync(localAdmPath)) fail(`Local ADM file not found: ${localAdmPath}`);
    source = "local";
    actualAdmFile = basename(localAdmPath);
    lines = splitAdmLines(readFileSync(localAdmPath, "utf8"));
  } else {
    const token = await tryLoadNitradoToken(target);
    if (!token) {
      fail(`No Nitrado token source found for --adm-file.

Use PowerShell:
$env:NITRADO_TOKEN="YOUR_NITRADO_TOKEN"
npm run repair:server-scope -- --slug ${requestedSlug} --adm-file ${requestedAdmFile} --dry-run

Or use --adm-local with a local copy of this server's ADM file.`);
    }
    if (!target.nitrado_service_id) fail("Target server has no nitrado_service_id for ADM file recovery.");
    tokenSource = token.source;
    const readable = await fetchReadableNitradoAdmLines(token.token, target.nitrado_service_id, {
      mode: "full",
      preferredAdmFileName: requestedAdmFile ?? undefined,
    });
    if (!readable.lines.length) {
      fail("Requested ADM file was not readable from Nitrado. Try using --adm-local with a local copy of the ADM file.");
    }
    actualAdmFile = readable.diagnostics.newestAdmFileName ?? requestedAdmFile ?? "unknown.ADM";
    if (requestedAdmFile && basename(actualAdmFile).toLowerCase() !== basename(requestedAdmFile).toLowerCase()) {
      fail("Requested ADM file was not readable from Nitrado. Try using --adm-local with a local copy of the ADM file.");
    }
    source = "nitrado";
    lines = readable.lines;
  }

  const killCandidates = await buildKillCandidates(lines, target.id, actualAdmFile);
  const existingTargetKeys = new Set(targetKills.flatMap((row) => [row.id, killFallbackKey(row)]));
  const existingOtherKeys = new Set(otherKills.map(killFallbackKey));
  const missingKills = killCandidates.filter((candidate) => !existingTargetKeys.has(candidate.primaryId) && !existingTargetKeys.has(candidate.fallbackKey) && !existingOtherKeys.has(candidate.fallbackKey));
  const duplicatesSkipped = killCandidates.filter((candidate) => existingTargetKeys.has(candidate.primaryId) || existingTargetKeys.has(candidate.fallbackKey)).length;
  const foreignSkipped = killCandidates.filter((candidate) => existingOtherKeys.has(candidate.fallbackKey)).length;

  return {
    source,
    requestedAdmFile: requestedAdmFile ?? (localAdmPath ? basename(localAdmPath) : null),
    actualAdmFile,
    linesScanned: lines.length,
    killCandidates,
    missingKills,
    duplicatesSkipped,
    foreignSkipped,
    tokenSource,
    error: null,
  };
}

function emptyAdmImportPlan(): AdmImportPlan {
  return {
    source: "none",
    requestedAdmFile: null,
    actualAdmFile: null,
    linesScanned: 0,
    killCandidates: [],
    missingKills: [],
    duplicatesSkipped: 0,
    foreignSkipped: 0,
    tokenSource: null,
    error: null,
  };
}

async function buildKillCandidates(lines: string[], linkedServerId: string, admFile: string) {
  const candidates: KillCandidate[] = [];
  const admDate = extractAdmDate(admFile) ?? undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseAdmLine(lines[index], { admDate });
    if (!isCreditedKill(parsed)) continue;
    candidates.push({
      parsed,
      lineNumber: index + 1,
      admFile,
      primaryId: stableSyncId("kill-event", linkedServerId, admFile, index + 1),
      fallbackKey: parsedFallbackKey(parsed),
    });
  }
  return candidates;
}

function isCreditedKill(event: ParsedAdmEvent) {
  return event.eventType === "player_killed" && event.isCreditedKill && /\bkilled by\s+Player\s+"/i.test(event.rawLine);
}

async function getProfiles(linkedServerId: string) {
  return d1Query<ProfileRow>(
    `SELECT id, player_name, player_id
     FROM player_profiles
     WHERE linked_server_id = ${sqlString(linkedServerId)}`,
  );
}

function buildRemoveForeignSql(foreignKills: ForeignKill[], foreignPlayerEvents: ForeignPlayerEvent[], foreignRawEvents: RawEventRow[]) {
  const statements: string[] = [];
  const killIds = uniqueStrings(foreignKills.map((row) => row.target.id));
  const playerEventIds = uniqueStrings(foreignPlayerEvents.map((row) => row.target.id));
  const rawIds = uniqueStrings(foreignRawEvents.map((row) => row.id));
  if (killIds.length) statements.push(`DELETE FROM kill_events WHERE id IN (${sqlList(killIds)})`);
  if (playerEventIds.length) statements.push(`DELETE FROM player_events WHERE id IN (${sqlList(playerEventIds)})`);
  if (rawIds.length) statements.push(`DELETE FROM adm_raw_events WHERE id IN (${sqlList(rawIds)})`);
  return statements.join(";\n");
}

function buildAdmInsertSql(linkedServerId: string, missingKills: KillCandidate[], existingProfiles: ProfileRow[]) {
  const profilePlan = buildProfilePlan(existingProfiles, missingKills);
  const statements: string[] = [];
  for (const profile of profilePlan.inserts) {
    statements.push(
      `INSERT OR IGNORE INTO player_profiles (id, linked_server_id, player_name, player_id, first_seen_at, created_at, updated_at)
       VALUES (${sqlValue(profile.id)}, ${sqlValue(linkedServerId)}, ${sqlValue(profile.player_name)}, ${sqlValue(profile.player_id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
  }
  for (const candidate of missingKills) {
    const profileIds = profilePlan.profileIdsByKill.get(candidate);
    statements.push(
      `INSERT OR IGNORE INTO adm_raw_events (id, linked_server_id, adm_file, line_number, raw_line, event_type, parsed, created_at)
       VALUES (${sqlValue(stableSyncId("raw", linkedServerId, candidate.admFile, candidate.lineNumber))}, ${sqlValue(linkedServerId)}, ${sqlValue(candidate.admFile)}, ${candidate.lineNumber}, ${sqlValue(candidate.parsed.rawLine)}, ${sqlValue(candidate.parsed.eventType)}, 1, CURRENT_TIMESTAMP)`,
    );
    statements.push(
      `INSERT OR IGNORE INTO kill_events (
         id, linked_server_id, killer_profile_id, victim_profile_id, killer_name, victim_name,
         killer_id, victim_id, weapon, distance, position_x, position_y, position_z,
         adm_file, line_number, occurred_at, raw_line, created_at
       ) VALUES (
         ${sqlValue(candidate.primaryId)}, ${sqlValue(linkedServerId)}, ${sqlValue(profileIds?.killerProfileId ?? null)}, ${sqlValue(profileIds?.victimProfileId ?? null)},
         ${sqlValue(candidate.parsed.killerName ?? candidate.parsed.playerName)}, ${sqlValue(candidate.parsed.victimName)},
         ${sqlValue(candidate.parsed.killerId ?? candidate.parsed.playerId)}, ${sqlValue(candidate.parsed.victimId)},
         ${sqlValue(candidate.parsed.weapon)}, ${sqlValue(candidate.parsed.distance)},
         ${sqlValue(candidate.parsed.killerPosition?.x ?? candidate.parsed.position?.x ?? null)},
         ${sqlValue(candidate.parsed.killerPosition?.y ?? candidate.parsed.position?.y ?? null)},
         ${sqlValue(candidate.parsed.killerPosition?.z ?? candidate.parsed.position?.z ?? null)},
         ${sqlValue(candidate.admFile)}, ${candidate.lineNumber}, ${sqlValue(candidate.parsed.occurredAt)}, ${sqlValue(candidate.parsed.rawLine)},
         CURRENT_TIMESTAMP
       )`,
    );
  }
  return statements.join(";\n");
}

function buildProfilePlan(existingProfiles: ProfileRow[], missingKills: KillCandidate[]) {
  const byPlayerId = new Map<string, ProfileRow>();
  const byPlayerName = new Map<string, ProfileRow>();
  for (const profile of existingProfiles) {
    if (profile.player_id) byPlayerId.set(profile.player_id, profile);
    byPlayerName.set(profile.player_name.toLowerCase(), profile);
  }

  const inserts = new Map<string, ProfileRow>();
  const profileIdsByKill = new Map<KillCandidate, { killerProfileId: string | null; victimProfileId: string | null }>();

  function resolve(name: string | null, playerId: string | null) {
    if (!name) return null;
    const existing = playerId ? byPlayerId.get(playerId) : byPlayerName.get(name.toLowerCase());
    if (existing) return existing.id;
    const key = playerId ? `id:${playerId}` : `name:${name.toLowerCase()}`;
    const planned = inserts.get(key);
    if (planned) return planned.id;
    const profile = { id: randomUUID(), player_name: name, player_id: playerId };
    inserts.set(key, profile);
    if (playerId) byPlayerId.set(playerId, profile);
    byPlayerName.set(name.toLowerCase(), profile);
    return profile.id;
  }

  for (const candidate of missingKills) {
    profileIdsByKill.set(candidate, {
      killerProfileId: resolve(candidate.parsed.killerName ?? candidate.parsed.playerName, candidate.parsed.killerId ?? candidate.parsed.playerId),
      victimProfileId: resolve(candidate.parsed.victimName, candidate.parsed.victimId),
    });
  }

  return { inserts: [...inserts.values()], profileIdsByKill };
}

function buildRebuildSql(linkedServerId: string) {
  const playerKey = "COALESCE(player_profiles.player_id, lower(player_profiles.player_name))";
  return `
    DELETE FROM player_profiles
    WHERE linked_server_id = ${sqlString(linkedServerId)}
      AND NOT EXISTS (
        SELECT 1 FROM kill_events
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND (
            COALESCE(killer_id, lower(killer_name)) = ${playerKey}
            OR COALESCE(victim_id, lower(victim_name)) = ${playerKey}
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM player_events
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND COALESCE(player_id, lower(player_name)) = ${playerKey}
      );

    INSERT INTO player_profiles (id, linked_server_id, player_name, player_id, kills, deaths, longest_kill_distance, first_seen_at, created_at, updated_at)
    SELECT 'scope-repair-profile-' || lower(hex(randomblob(16))), ${sqlString(linkedServerId)}, player_name, player_id, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM (
      SELECT killer_name AS player_name, killer_id AS player_id, COALESCE(killer_id, lower(killer_name)) AS player_key
      FROM kill_events
      WHERE linked_server_id = ${sqlString(linkedServerId)} AND killer_name IS NOT NULL
      UNION
      SELECT victim_name AS player_name, victim_id AS player_id, COALESCE(victim_id, lower(victim_name)) AS player_key
      FROM kill_events
      WHERE linked_server_id = ${sqlString(linkedServerId)} AND victim_name IS NOT NULL
      UNION
      SELECT player_name, player_id, COALESCE(player_id, lower(player_name)) AS player_key
      FROM player_events
      WHERE linked_server_id = ${sqlString(linkedServerId)} AND player_name IS NOT NULL
    ) AS players
    WHERE player_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM player_profiles
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND COALESCE(player_id, lower(player_name)) = players.player_key
      );

    UPDATE player_profiles
    SET
      kills = (
        SELECT COUNT(*) FROM kill_events
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND COALESCE(killer_id, lower(killer_name)) = ${playerKey}
      ),
      deaths = (
        SELECT COUNT(*) FROM kill_events
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND COALESCE(victim_id, lower(victim_name)) = ${playerKey}
      ) + (
        SELECT COUNT(*) FROM player_events
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
          AND COALESCE(player_id, lower(player_name)) = ${playerKey}
      ),
      longest_kill_distance = COALESCE((
        SELECT MAX(distance) FROM kill_events
        WHERE linked_server_id = ${sqlString(linkedServerId)}
          AND COALESCE(killer_id, lower(killer_name)) = ${playerKey}
      ), 0),
      last_seen_at = (
        SELECT MAX(event_time) FROM (
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM kill_events
          WHERE linked_server_id = ${sqlString(linkedServerId)}
            AND (COALESCE(killer_id, lower(killer_name)) = ${playerKey} OR COALESCE(victim_id, lower(victim_name)) = ${playerKey})
          UNION ALL
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM player_events
          WHERE linked_server_id = ${sqlString(linkedServerId)}
            AND COALESCE(player_id, lower(player_name)) = ${playerKey}
        )
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE linked_server_id = ${sqlString(linkedServerId)};

    INSERT INTO server_stats (id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects, unique_players, last_event_at, updated_at)
    VALUES (
      ${sqlString(`server-stats-${linkedServerId}`)},
      ${sqlString(linkedServerId)},
      (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(linkedServerId)}),
      (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND victim_name IS NOT NULL)
        + (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')),
      (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND event_type = 'player_connected'),
      (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND event_type = 'player_disconnected'),
      (
        SELECT COUNT(DISTINCT player_key) FROM (
          SELECT COALESCE(killer_id, lower(killer_name)) AS player_key FROM kill_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND killer_name IS NOT NULL
          UNION
          SELECT COALESCE(victim_id, lower(victim_name)) AS player_key FROM kill_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND victim_name IS NOT NULL
          UNION
          SELECT COALESCE(player_id, lower(player_name)) AS player_key FROM player_events WHERE linked_server_id = ${sqlString(linkedServerId)} AND player_name IS NOT NULL
        )
      ),
      (
        SELECT MAX(event_time) FROM (
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM kill_events WHERE linked_server_id = ${sqlString(linkedServerId)}
          UNION ALL
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM player_events WHERE linked_server_id = ${sqlString(linkedServerId)}
        )
      ),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(linked_server_id) DO UPDATE SET
      total_kills = excluded.total_kills,
      total_deaths = excluded.total_deaths,
      total_joins = excluded.total_joins,
      total_disconnects = excluded.total_disconnects,
      unique_players = excluded.unique_players,
      last_event_at = excluded.last_event_at,
      updated_at = CURRENT_TIMESTAMP;
  `;
}

async function tryLoadNitradoToken(linkedServer: LinkedServerRow): Promise<{ token: string; source: TokenSource } | null> {
  const directToken = process.env.NITRADO_TOKEN?.trim();
  if (directToken) return { token: directToken, source: "environment/direct" };

  const tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (tokenEncryptionKey && linkedServer.user_id) {
    const tokenRow = await getTokenRow(linkedServer.id, linkedServer.user_id).catch(() => null);
    if (tokenRow) {
      try {
        return {
          token: await decryptToken(tokenRow.encrypted_token, tokenRow.token_iv, tokenRow.token_auth_tag, tokenEncryptionKey),
          source: "stored",
        };
      } catch {
        // Fall through to optional local token file.
      }
    }
  }

  if (existsSync(LOCAL_TOKEN_FILE)) {
    const token = readFileSync(LOCAL_TOKEN_FILE, "utf8").trim();
    if (token) return { token, source: "local file" };
  }

  return null;
}

async function getTokenRow(linkedServerId: string, userId: string) {
  const rows = await d1Query<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>(
    `SELECT encrypted_token, token_iv, token_auth_tag
     FROM nitrado_connections
     WHERE linked_server_id = ${sqlString(linkedServerId)} AND user_id = ${sqlString(userId)}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function runSqlPhase(sqlCommand: string, phase: ApplyPhase) {
  if (!sqlCommand.trim()) return;
  const dir = mkdtempSync(join(tmpdir(), "dzn-server-scope-repair-"));
  const file = join(dir, `${phase.toLowerCase()}.sql`);
  try {
    writeFileSync(file, ensureSqlFileTerminates(sqlCommand), "utf8");
    runWranglerFileApply(file);
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    printD1ApplyFailure(error, file, phase);
  } finally {
    if (!existsSync(file)) rmSync(dir, { recursive: true, force: true });
  }
}

function ensureSqlFileTerminates(sqlCommand: string) {
  const trimmed = sqlCommand.trim();
  return trimmed.endsWith(";") ? `${trimmed}\n` : `${trimmed};\n`;
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) fail(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

function runWrangler(args: string[]) {
  return runWranglerNode(args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
}

function runWranglerFileApply(sqlFilePath: string) {
  return runWranglerNode(["d1", "execute", DATABASE_NAME, "--remote", `--file=${sqlFilePath}`], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

function runWranglerNode(args: string[], options: ExecFileSyncOptionsWithStringEncoding) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...args], {
    ...options,
    encoding: "utf8",
  });
}

function printD1ApplyFailure(error: unknown, sqlFilePath: string, phase: ApplyPhase): never {
  const commandError = error as { stdout?: unknown; stderr?: unknown; message?: string };
  console.error(`D1 apply failed during phase: ${phase}`);
  console.error("Wrangler stdout:");
  console.error(normalizeCommandOutput(commandError.stdout) || "(empty)");
  console.error("Wrangler stderr:");
  console.error(normalizeCommandOutput(commandError.stderr) || commandError.message || "(empty)");
  console.error(`Server scope repair SQL file kept for debugging:\n${sqlFilePath}`);
  process.exit(1);
}

function normalizeCommandOutput(value: unknown) {
  if (!value) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function parseWranglerJson(output: string) {
  try {
    return JSON.parse(output) as Array<{ success: boolean; results?: unknown[] }>;
  } catch {
    fail(`Unable to parse Wrangler JSON output:\n${output}`);
  }
}

function parseArgs(values: string[]) {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function resolveMode(values: Map<string, string | true>): Mode {
  const dryRun = Boolean(values.get("dry-run"));
  const apply = Boolean(values.get("apply"));
  if (dryRun === apply) fail("Choose exactly one mode: --dry-run or --apply.");
  return apply ? "apply" : "dry-run";
}

function stringArg(values: Map<string, string | true>, key: string) {
  const value = values.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function killFallbackKey(row: KillRow) {
  return [
    row.occurred_at ?? "",
    row.killer_id ?? row.killer_name ?? "",
    row.victim_id ?? row.victim_name ?? "",
    row.weapon ?? "",
    normalizeDistance(row.distance),
  ].join("|").toLowerCase();
}

function parsedFallbackKey(event: ParsedAdmEvent) {
  return [
    event.occurredAt ?? "",
    event.killerId ?? event.killerName ?? event.playerId ?? event.playerName ?? "",
    event.victimId ?? event.victimName ?? "",
    event.weapon ?? "",
    normalizeDistance(event.distance),
  ].join("|").toLowerCase();
}

function playerEventFallbackKey(row: PlayerEventRow) {
  return [
    row.event_type ?? "",
    row.occurred_at ?? "",
    row.player_id ?? row.player_name ?? "",
    row.raw_line ? normalizeRawLine(row.raw_line) : "",
  ].join("|").toLowerCase();
}

function playerIdentity(playerId: string | null, playerName: string | null) {
  const value = playerId ?? playerName;
  return value ? value.toLowerCase() : null;
}

function normalizeRawLine(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeDistance(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : "";
}

function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  const hash = createHash("sha256").update(input).digest("hex");
  return `${prefix}:${hash.slice(0, 48)}`;
}

function splitAdmLines(content: string) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function extractAdmDate(fileName: string | null) {
  return fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null : null;
}

function slugCandidates(...values: Array<string | null>) {
  const candidates = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = value.trim().toLowerCase();
    candidates.add(normalized.replace(/[^a-z0-9]/g, "").slice(0, 90));
    candidates.add(normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90));
    candidates.add(normalized.replace(/[^a-z0-9-]/g, "").slice(0, 90));
  }
  candidates.delete("");
  return candidates;
}

function sanitizeSlug(value: string | null) {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
}

function serverDisplayName(server: LinkedServerRow) {
  return firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name) ?? server.id;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(isNonEmptyString)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sqlList(values: string[]) {
  return values.map(sqlString).join(", ");
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return sqlString(String(value));
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function loadEnvFiles() {
  for (const file of [".env.local", ".env", ".dev.vars"]) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      if (process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function fail(message: string): never {
  throw new Error(message);
}
