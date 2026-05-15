/**
 * ONE-TIME LOCAL RE-ADDED SERVER REPAIR SCRIPT
 *
 * This script is not part of normal DZN sync.
 * It only runs when manually executed from the terminal.
 * It merges duplicate linked_server rows for the same Nitrado service id,
 * rebuilds authoritative stats, marks old duplicate rows as merged, then exits.
 *
 * Normal scheduled/manual ADM sync continues as usual afterwards.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { parseAdmLine, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { decryptToken } from "../functions/_lib/crypto";
import { fetchReadableNitradoAdmLines, type NitradoLogAccessDiagnostics } from "../functions/_lib/nitrado";

const DATABASE_NAME = "dzn_network_db";
const DEFAULT_ADM_FILE = "DayZServer_PS4_x64_2026-05-15_19-42-40.ADM";
const LOCAL_TOKEN_FILE = ".local-nitrado-token";

type Mode = "dry-run" | "apply";
type ApplyPhase = "SCHEMA" | "DEDUP_KILLS" | "UNIQUE_STATE" | "MOVE_CHILDREN" | "RECOVERY_INSERTS" | "RECOVERY_CURSOR" | "REBUILD_TOTALS";
type TokenSource = "environment/direct" | "stored" | "local file";

type LinkedServerRow = Record<string, unknown> & {
  id: string;
  user_id: string | null;
  guild_id: string | null;
  discord_guild_id: string | null;
  nitrado_service_id: string | null;
  nitrado_service_name: string | null;
  server_name: string | null;
  display_name: string | null;
  hostname: string | null;
  public_slug: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  merged_into_server_id?: string | null;
  merged_at?: string | null;
};

type ServerSummary = LinkedServerRow & {
  kill_events: number;
  death_events: number;
  raw_events: number;
  player_events: number;
  player_profiles: number;
  sync_runs: number;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  last_processed_file: string | null;
  last_processed_line: number;
  last_sync_at: string | null;
};

type KillRow = {
  id: string;
  linked_server_id: string;
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
};

type RawAdmRow = {
  adm_file: string | null;
  line_number: number | null;
  raw_line: string;
};

type TokenRow = {
  encrypted_token: string;
  token_iv: string;
  token_auth_tag: string;
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

type AdmRecoveryPlan = {
  source: "local" | "nitrado" | "raw_events" | "unavailable";
  tokenSource: TokenSource | null;
  requestedAdmFile: string | null;
  admFile: string | null;
  admPath: string | null;
  linesScanned: number;
  killCandidates: KillCandidate[];
  missingKills: KillCandidate[];
  duplicatesSkipped: number;
  currentKillEvents: number;
  currentServerTotalKills: number;
  expectedTotalKills: number;
  playersTouched: number;
  error: string | null;
};

loadEnvFiles();

const args = parseArgs(process.argv.slice(2));
const requestedServiceId = stringArg(args, "service-id");
const mode = resolveMode(args);
const requestedAdmFile = stringArg(args, "adm-file");
const localAdmPath = stringArg(args, "adm-local");

const serviceId = requestedServiceId ?? fail("Missing --service-id. Example: npm run repair:readded-server -- --service-id 18765761 --dry-run");

main().catch((error) => {
  console.error("Re-added server repair failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const linkedServerColumns = await getColumns("linked_servers");
  const serviceColumns = ["nitrado_service_id", "service_id"].filter((column) => linkedServerColumns.has(column));
  if (!serviceColumns.length) fail("linked_servers does not contain nitrado_service_id or service_id.");

  const rows = await findServerRows(serviceColumns, serviceId);
  if (!rows.length) fail(`No linked server rows found for service id ${serviceId}.`);

  const summaries = await Promise.all(rows.map((row) => summarizeServer(row)));
  const canonical = chooseCanonicalServer(summaries);
  const duplicates = summaries.filter((row) => row.id !== canonical.id);
  const metadataSource = chooseMetadataSource(summaries);
  const targetSlug = chooseTargetSlug(summaries, metadataSource);
  const killRows = await getKillRows(summaries.map((row) => row.id));
  const duplicateKillIds = findDuplicateKillIds(killRows, canonical.id);
  const expectedKillsAfterMerge = countUniqueKills(killRows);
  const recovery = await buildAdmRecoveryPlan(canonical, killRows);

  printPlan({
    summaries,
    canonical,
    duplicates,
    metadataSource,
    targetSlug,
    duplicateKillIds,
    expectedKillsAfterMerge,
    recovery,
  });

  if (mode === "dry-run") {
    console.log("");
    console.log("No database changes made.");
    return;
  }

  if (!duplicates.length) {
    if (recovery.missingKills.length) {
      await applyAdmRecovery(canonical, recovery);
    }
    await runSqlPhase(buildRebuildSql(canonical.id), "REBUILD_TOTALS");
    const repaired = await summarizeServer(canonical);
    console.log("");
    if (!recovery.missingKills.length) {
      console.log("No missing kills found.");
      console.log("Database already up to date.");
    } else {
      console.log("DZN READDED SERVER STATS REPAIRED");
      console.log("");
      console.log(`Service ID: ${serviceId}`);
      console.log(`Server: ${firstString(canonical.display_name, canonical.hostname, canonical.server_name, canonical.nitrado_service_name) ?? canonical.id}`);
      console.log(`Linked server ID: ${canonical.id}`);
      console.log(`ADM file: ${recovery.admFile ?? "not checked"}`);
      console.log(`Lines scanned: ${recovery.linesScanned}`);
      console.log(`Kill lines found: ${recovery.killCandidates.length}`);
      console.log(`New kills inserted: ${recovery.missingKills.length}`);
      console.log(`Duplicates skipped: ${recovery.duplicatesSkipped}`);
      console.log(`Players rebuilt: ${recovery.playersTouched}`);
      console.log(`Server total kills: ${repaired.total_kills || repaired.kill_events}`);
      console.log(`Server total deaths: ${repaired.total_deaths || repaired.death_events}`);
      console.log(`Unique players: ${repaired.unique_players}`);
      console.log(`Cursor updated to line: ${recovery.linesScanned}`);
      console.log("Normal ADM auto-sync can now continue from the corrected server row.");
    }
    return;
  }

  await runSqlPhase(buildSchemaSql(linkedServerColumns), "SCHEMA");
  await runSqlPhase(buildDeleteDuplicateKillsSql(duplicateKillIds), "DEDUP_KILLS");
  await runSqlPhase(await buildUniqueStateSql(summaries, canonical.id), "UNIQUE_STATE");
  await runSqlPhase(await buildMoveChildrenSql(duplicates.map((row) => row.id), canonical.id), "MOVE_CHILDREN");
  if (recovery.missingKills.length) {
    await applyAdmRecovery(canonical, recovery);
  }
  await runSqlPhase(buildRebuildSql(canonical.id, metadataSource, targetSlug, duplicates.map((row) => row.id)), "REBUILD_TOTALS");

  const repaired = await summarizeServer((await findServerRows(serviceColumns, serviceId)).find((row) => row.id === canonical.id) ?? canonical);
  console.log("");
  console.log("DZN READDED SERVER STATS REPAIRED");
  console.log("");
  console.log(`Service ID: ${serviceId}`);
  console.log(`Canonical linked_server_id: ${canonical.id}`);
  console.log(`Merged duplicate rows: ${duplicates.length}`);
  console.log(`Recovered missing kills: ${recovery.missingKills.length}`);
  console.log(`Duplicate kill rows removed: ${duplicateKillIds.length}`);
  console.log(`Server total kills: ${repaired.total_kills || repaired.kill_events}`);
  console.log(`Server total deaths: ${repaired.total_deaths || repaired.death_events}`);
  console.log(`Unique players: ${repaired.unique_players}`);
  console.log(`Public slug: ${targetSlug}`);
  console.log("Normal ADM auto-sync can now continue on the canonical server row.");
}

function printPlan(input: {
  summaries: ServerSummary[];
  canonical: ServerSummary;
  duplicates: ServerSummary[];
  metadataSource: ServerSummary;
  targetSlug: string;
  duplicateKillIds: string[];
  expectedKillsAfterMerge: number;
  recovery: AdmRecoveryPlan;
}) {
  console.log(mode === "dry-run" ? "DZN re-added server recovery dry run." : "DZN re-added server recovery apply.");
  console.log("");
  console.log(`Service ID: ${serviceId}`);
  console.log(`Rows found: ${input.summaries.length}`);
  console.table(input.summaries.map((row) => ({
    id: row.id,
    display_name: firstString(row.display_name, row.hostname, row.server_name, row.nitrado_service_name),
    slug: row.public_slug,
    status: row.status,
    merged_into: row.merged_into_server_id ?? null,
    kills: row.total_kills || row.kill_events,
    deaths: row.total_deaths || row.death_events,
    joins: row.total_joins,
    unique_players: row.unique_players,
    kill_events: row.kill_events,
    player_events: row.player_events,
    raw_events: row.raw_events,
    sync_runs: row.sync_runs,
    cursor_file: row.last_processed_file,
    cursor_line: row.last_processed_line,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })));
  console.log(`Recommended canonical row: ${input.canonical.id}`);
  console.log(`Metadata source row: ${input.metadataSource.id}`);
  console.log(`Target public slug: ${input.targetSlug}`);
  console.log(`Rows that would be merged: ${input.duplicates.length ? input.duplicates.map((row) => row.id).join(", ") : "none"}`);
  console.log(`Duplicate kill rows that would be removed: ${input.duplicateKillIds.length}`);
  console.log("");
  console.log(`Current kill_events attached: ${input.recovery.currentKillEvents}`);
  console.log(`Current server total kills: ${input.recovery.currentServerTotalKills}`);
  console.log(`Requested ADM file: ${input.recovery.requestedAdmFile ?? "latest readable ADM file"}`);
  console.log(`Actual ADM file used: ${input.recovery.admFile ?? "not available"}`);
  console.log(`ADM source: ${input.recovery.source}`);
  console.log(`Lines scanned: ${input.recovery.linesScanned}`);
  console.log(`Kill lines found: ${input.recovery.killCandidates.length}`);
  console.log(`Existing kills skipped: ${input.recovery.duplicatesSkipped}`);
  console.log(`Missing kill_events to insert: ${input.recovery.missingKills.length}`);
  console.log(`Players that would be rebuilt: ${input.recovery.playersTouched}`);
  console.log(`Expected total kills after recovery: ${input.recovery.expectedTotalKills}`);
  if (input.recovery.error) console.log(`Recovery note: ${input.recovery.error}`);
  console.log(`Expected server total kills after repair: ${Math.max(input.expectedKillsAfterMerge, input.recovery.expectedTotalKills)}`);
}

async function findServerRows(serviceColumns: string[], requestedServiceId: string) {
  const where = serviceColumns.map((column) => `${column} = ${sqlString(requestedServiceId)}`).join(" OR ");
  return d1Query<LinkedServerRow>(`SELECT * FROM linked_servers WHERE ${where} ORDER BY updated_at DESC, created_at DESC`);
}

async function summarizeServer(row: LinkedServerRow): Promise<ServerSummary> {
  const stats = await d1Query<{
    kill_events: number;
    death_events: number;
    raw_events: number;
    player_events: number;
    player_profiles: number;
    sync_runs: number;
    total_kills: number | null;
    total_deaths: number | null;
    total_joins: number | null;
    total_disconnects: number | null;
    unique_players: number | null;
    last_processed_file: string | null;
    last_processed_line: number | null;
    last_sync_at: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(row.id)}) AS kill_events,
       (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(row.id)} AND victim_name IS NOT NULL) AS death_events,
       (SELECT COUNT(*) FROM adm_raw_events WHERE linked_server_id = ${sqlString(row.id)}) AS raw_events,
       (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(row.id)}) AS player_events,
       (SELECT COUNT(*) FROM player_profiles WHERE linked_server_id = ${sqlString(row.id)}) AS player_profiles,
       (SELECT COUNT(*) FROM sync_runs WHERE linked_server_id = ${sqlString(row.id)}) AS sync_runs,
       (SELECT total_kills FROM server_stats WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS total_kills,
       (SELECT total_deaths FROM server_stats WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS total_deaths,
       (SELECT total_joins FROM server_stats WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS total_joins,
       (SELECT total_disconnects FROM server_stats WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS total_disconnects,
       (SELECT unique_players FROM server_stats WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS unique_players,
       (SELECT last_processed_file FROM adm_sync_state WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS last_processed_file,
       (SELECT last_processed_line FROM adm_sync_state WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS last_processed_line,
       (SELECT last_sync_at FROM adm_sync_state WHERE linked_server_id = ${sqlString(row.id)} LIMIT 1) AS last_sync_at`,
  );
  const result = stats[0];
  return {
    ...row,
    kill_events: Number(result?.kill_events ?? 0),
    death_events: Number(result?.death_events ?? 0),
    raw_events: Number(result?.raw_events ?? 0),
    player_events: Number(result?.player_events ?? 0),
    player_profiles: Number(result?.player_profiles ?? 0),
    sync_runs: Number(result?.sync_runs ?? 0),
    total_kills: Number(result?.total_kills ?? 0),
    total_deaths: Number(result?.total_deaths ?? 0),
    total_joins: Number(result?.total_joins ?? 0),
    total_disconnects: Number(result?.total_disconnects ?? 0),
    unique_players: Number(result?.unique_players ?? 0),
    last_processed_file: result?.last_processed_file ?? null,
    last_processed_line: Number(result?.last_processed_line ?? 0),
    last_sync_at: result?.last_sync_at ?? null,
  };
}

function chooseCanonicalServer(rows: ServerSummary[]) {
  return [...rows].sort((a, b) => canonicalScore(b) - canonicalScore(a) || dateValue(b.updated_at) - dateValue(a.updated_at))[0];
}

function canonicalScore(row: ServerSummary) {
  const statusScore = lower(row.status) === "live" ? 100 : lower(row.status) === "pending" ? 10 : 0;
  const slugScore = row.public_slug ? 25 : 0;
  return Math.max(row.total_kills, row.kill_events) * 10_000 +
    row.player_events * 100 +
    row.raw_events +
    statusScore +
    slugScore;
}

function chooseMetadataSource(rows: ServerSummary[]) {
  return [...rows].sort((a, b) => dateValue(b.updated_at) - dateValue(a.updated_at) || canonicalScore(b) - canonicalScore(a))[0];
}

function chooseTargetSlug(rows: ServerSummary[], metadataSource: ServerSummary) {
  const nuketownSlug = rows.find((row) => row.public_slug === "nuketown-deathmatch")?.public_slug;
  if (nuketownSlug) return nuketownSlug;
  const liveSlug = rows.find((row) => lower(row.status) === "live" && row.public_slug)?.public_slug;
  if (liveSlug) return liveSlug;
  if (metadataSource.public_slug) return metadataSource.public_slug;
  return toPublicSlug(firstString(metadataSource.display_name, metadataSource.hostname, metadataSource.server_name, metadataSource.nitrado_service_name) ?? "dayz-server");
}

async function getKillRows(serverIds: string[]) {
  if (!serverIds.length) return [];
  return d1Query<KillRow>(
    `SELECT id, linked_server_id, adm_file, line_number, killer_id, killer_name, victim_id, victim_name, weapon, distance, occurred_at, created_at
     FROM kill_events
     WHERE linked_server_id IN (${sqlList(serverIds)})
     ORDER BY linked_server_id ASC, COALESCE(occurred_at, created_at) ASC`,
  );
}

async function buildAdmRecoveryPlan(canonical: ServerSummary, existingServiceKills: KillRow[]): Promise<AdmRecoveryPlan> {
  const currentKillEvents = existingServiceKills.filter((row) => row.linked_server_id === canonical.id).length;
  const currentServerTotalKills = Math.max(canonical.total_kills, currentKillEvents);
  if (localAdmPath) {
    const localRecovery = await buildLocalAdmRecovery(canonical.id, localAdmPath, existingServiceKills);
    return {
      ...localRecovery,
      currentKillEvents,
      currentServerTotalKills,
      expectedTotalKills: currentKillEvents + localRecovery.missingKills.length,
      playersTouched: countCandidatePlayers(localRecovery.missingKills),
    };
  }

  const tokenSource = await tryLoadNitradoToken(canonical);
  if (requestedAdmFile && !tokenSource) {
    fail(`No Nitrado token source found for forced ADM file recovery.

Use PowerShell:
$env:NITRADO_TOKEN="YOUR_NITRADO_TOKEN"
npm run repair:readded-server -- --service-id ${serviceId} --adm-file ${requestedAdmFile} --dry-run

Or use --adm-local with a local copy of the ADM file.`);
  }

  const nitradoRecovery = tokenSource
    ? await tryBuildNitradoRecovery(canonical.id, tokenSource, existingServiceKills).catch((error) => {
        if (isNitradoTokenError(error)) fail("Nitrado token was rejected. Please check the token and try again.");
        if (requestedAdmFile) fail(error instanceof Error ? error.message : String(error));
        return null;
      })
    : null;

  if (nitradoRecovery?.killCandidates.length) {
    return {
      ...nitradoRecovery,
      currentKillEvents,
      currentServerTotalKills,
      expectedTotalKills: currentKillEvents + nitradoRecovery.missingKills.length,
      playersTouched: countCandidatePlayers(nitradoRecovery.missingKills),
    };
  }

  const rawRecovery = await buildRawEventRecovery(canonical.id, existingServiceKills);
  if (rawRecovery.killCandidates.length) {
    return {
      ...rawRecovery,
      currentKillEvents,
      currentServerTotalKills,
      expectedTotalKills: currentKillEvents + rawRecovery.missingKills.length,
      playersTouched: countCandidatePlayers(rawRecovery.missingKills),
      error: nitradoRecovery?.error ?? null,
    };
  }

  return {
    source: tokenSource ? "nitrado" : "unavailable",
    tokenSource: tokenSource?.source ?? null,
    requestedAdmFile: requestedAdmFile ?? null,
    admFile: nitradoRecovery?.admFile ?? rawRecovery.admFile,
    admPath: nitradoRecovery?.admPath ?? rawRecovery.admPath,
    linesScanned: nitradoRecovery?.linesScanned ?? rawRecovery.linesScanned,
    killCandidates: [],
    missingKills: [],
    duplicatesSkipped: 0,
    currentKillEvents,
    currentServerTotalKills,
    expectedTotalKills: currentKillEvents,
    playersTouched: 0,
    error: nitradoRecovery?.error ?? rawRecovery.error ?? (tokenSource ? "No credited PvP kill lines were found in the readable ADM source." : "No raw kill lines were stored locally and no Nitrado token source was available."),
  };
}

async function buildLocalAdmRecovery(linkedServerId: string, filePath: string, existingServiceKills: KillRow[]): Promise<AdmRecoveryPlan> {
  if (!existsSync(filePath)) fail(`Local ADM file not found: ${filePath}`);
  const admFile = basename(filePath);
  const lines = splitLocalAdmLines(readFileSync(filePath, "utf8"));
  const candidates = await buildKillCandidatesFromLines(lines, linkedServerId, admFile);
  const missingKills = filterMissingKills(candidates, existingServiceKills);
  return {
    source: "local",
    tokenSource: null,
    requestedAdmFile: requestedAdmFile ?? admFile,
    admFile,
    admPath: admFile,
    linesScanned: lines.length,
    killCandidates: candidates,
    missingKills,
    duplicatesSkipped: candidates.length - missingKills.length,
    currentKillEvents: 0,
    currentServerTotalKills: 0,
    expectedTotalKills: 0,
    playersTouched: 0,
    error: null,
  };
}

async function tryBuildNitradoRecovery(
  linkedServerId: string,
  tokenSource: { token: string; source: TokenSource },
  existingServiceKills: KillRow[],
): Promise<AdmRecoveryPlan | null> {
  const readable = await fetchReadableNitradoAdmLines(tokenSource.token, serviceId, {
    mode: "full",
    preferredAdmFileName: requestedAdmFile ?? undefined,
  });
  if (isNitradoTokenRejected(readable.diagnostics)) {
    fail("Nitrado token was rejected. Please check the token and try again.");
  }
  if (!readable.lines.length) {
    if (requestedAdmFile) {
      fail(`Requested ADM file was not readable from Nitrado.
Try using --adm-local with a local copy of the ADM file.`);
    }
    return {
      source: "nitrado",
      tokenSource: tokenSource.source,
      requestedAdmFile: requestedAdmFile ?? null,
      admFile: readable.diagnostics.newestAdmFileName ?? requestedAdmFile ?? null,
      admPath: readable.diagnostics.testedPathVariants?.[0] ?? readable.diagnostics.newestAdmFileName ?? requestedAdmFile ?? null,
      linesScanned: 0,
      killCandidates: [],
      missingKills: [],
      duplicatesSkipped: 0,
      currentKillEvents: 0,
      currentServerTotalKills: 0,
      expectedTotalKills: 0,
      playersTouched: 0,
      error: readable.diagnostics.readable.message || "Nitrado did not return readable ADM lines.",
    };
  }

  const admFile = readable.diagnostics.newestAdmFileName ?? requestedAdmFile ?? DEFAULT_ADM_FILE;
  if (requestedAdmFile && !sameAdmFile(admFile, requestedAdmFile)) {
    fail(`Requested ADM file was not readable from Nitrado.
Try using --adm-local with a local copy of the ADM file.`);
  }
  if (requestedAdmFile && !["file_server/download", "file_server/seek"].includes(readable.diagnostics.readable.method ?? "")) {
    fail(`Requested ADM file was not readable from Nitrado.
Try using --adm-local with a local copy of the ADM file.`);
  }
  const candidates = await buildKillCandidatesFromLines(readable.lines, linkedServerId, admFile);
  const missingKills = filterMissingKills(candidates, existingServiceKills);
  return {
    source: "nitrado",
    tokenSource: tokenSource.source,
    requestedAdmFile: requestedAdmFile ?? null,
    admFile,
    admPath: readable.diagnostics.testedPathVariants?.[0] ?? admFile,
    linesScanned: readable.lines.length,
    killCandidates: candidates,
    missingKills,
    duplicatesSkipped: candidates.length - missingKills.length,
    currentKillEvents: 0,
    currentServerTotalKills: 0,
    expectedTotalKills: 0,
    playersTouched: 0,
    error: null,
  };
}

async function buildRawEventRecovery(linkedServerId: string, existingServiceKills: KillRow[]): Promise<AdmRecoveryPlan> {
  const rawRows = await getRawKillRows(linkedServerId);
  const candidates = await buildKillCandidatesFromRawRows(rawRows, linkedServerId);
  const missingKills = filterMissingKills(candidates, existingServiceKills);
  const maxLineNumber = rawRows.reduce((max, row) => Math.max(max, Number(row.line_number ?? 0)), 0);
  const admFile = firstString(...rawRows.map((row) => row.adm_file)) ?? null;
  return {
    source: "raw_events",
    tokenSource: null,
    requestedAdmFile: requestedAdmFile ?? null,
    admFile,
    admPath: admFile,
    linesScanned: maxLineNumber || rawRows.length,
    killCandidates: candidates,
    missingKills,
    duplicatesSkipped: candidates.length - missingKills.length,
    currentKillEvents: 0,
    currentServerTotalKills: 0,
    expectedTotalKills: 0,
    playersTouched: 0,
    error: rawRows.length ? null : "No stored raw ADM kill lines were found for this linked server.",
  };
}

async function getRawKillRows(linkedServerId: string) {
  return d1Query<RawAdmRow>(
    `SELECT adm_file, line_number, raw_line
     FROM adm_raw_events
     WHERE linked_server_id = ${sqlString(linkedServerId)}
       AND raw_line LIKE '%killed by Player%'
     ORDER BY COALESCE(line_number, 0) ASC, created_at ASC`,
  );
}

async function buildKillCandidatesFromLines(lines: string[], linkedServerId: string, admFile: string) {
  const candidates: KillCandidate[] = [];
  const admDate = extractAdmDate(admFile) ?? undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = await buildKillCandidate(lines[index], linkedServerId, admFile, index + 1, admDate);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

async function buildKillCandidatesFromRawRows(rows: RawAdmRow[], linkedServerId: string) {
  const candidates: KillCandidate[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const admFile = row.adm_file ?? requestedAdmFile ?? DEFAULT_ADM_FILE;
    const lineNumber = Number(row.line_number ?? 0) > 0 ? Number(row.line_number) : index + 1;
    const candidate = await buildKillCandidate(row.raw_line, linkedServerId, admFile, lineNumber, extractAdmDate(admFile) ?? undefined);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

async function buildKillCandidate(rawLine: string, linkedServerId: string, admFile: string, lineNumber: number, admDate?: string) {
  const event = parseAdmLine(rawLine, { admDate });
  if (!isCreditedKill(event)) return null;
  return {
    parsed: event,
    lineNumber,
    admFile,
    primaryId: await stableSyncId("kill-event", linkedServerId, admFile, lineNumber),
    fallbackKey: parsedFallbackKey(event),
  } satisfies KillCandidate;
}

function isCreditedKill(event: ParsedAdmEvent) {
  return event.eventType === "player_killed" && event.isCreditedKill && /\bkilled by\s+Player\s+"/i.test(event.rawLine);
}

function filterMissingKills(candidates: KillCandidate[], existingServiceKills: KillRow[]) {
  const existingPrimaryIds = new Set(existingServiceKills.map((row) => row.id));
  const existingFallbackKeys = new Set(existingServiceKills.map(killFallbackKey));
  return candidates.filter((candidate) => !existingPrimaryIds.has(candidate.primaryId) && !existingFallbackKeys.has(candidate.fallbackKey));
}

async function getProfiles(linkedServerId: string) {
  return d1Query<ProfileRow>(
    `SELECT id, player_name, player_id
     FROM player_profiles
     WHERE linked_server_id = ${sqlString(linkedServerId)}`,
  );
}

async function applyAdmRecovery(canonical: ServerSummary, recovery: AdmRecoveryPlan) {
  if (!recovery.missingKills.length || !recovery.admFile) return;
  const profilePlan = buildProfilePlan(await getProfiles(canonical.id), recovery.missingKills);
  await runSqlPhase(buildRecoveryInsertSql(canonical.id, recovery.missingKills, profilePlan), "RECOVERY_INSERTS");
  await runSqlPhase(await buildRecoveryCursorSql(canonical.id, recovery), "RECOVERY_CURSOR");
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
    const profile = { id: crypto.randomUUID(), player_name: name, player_id: playerId };
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

function buildRecoveryInsertSql(linkedServerId: string, missingKills: KillCandidate[], profilePlan: ReturnType<typeof buildProfilePlan>) {
  const statements: string[] = [];
  for (const profile of profilePlan.inserts) {
    statements.push(
      `INSERT OR IGNORE INTO player_profiles (id, linked_server_id, player_name, player_id, first_seen_at, created_at, updated_at)
       VALUES (${sqlValue(profile.id)}, ${sqlValue(linkedServerId)}, ${sqlValue(profile.player_name)}, ${sqlValue(profile.player_id)}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
  }

  for (const candidate of missingKills) {
    const profileIds = profilePlan.profileIdsByKill.get(candidate);
    const rawId = stableSyncIdSync("raw", linkedServerId, candidate.admFile, candidate.lineNumber);
    statements.push(
      `INSERT OR IGNORE INTO adm_raw_events (id, linked_server_id, adm_file, line_number, raw_line, event_type, parsed, created_at)
       VALUES (${sqlValue(rawId)}, ${sqlValue(linkedServerId)}, ${sqlValue(candidate.admFile)}, ${candidate.lineNumber}, ${sqlValue(candidate.parsed.rawLine)}, ${sqlValue(candidate.parsed.eventType)}, 1, CURRENT_TIMESTAMP)`,
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

async function buildRecoveryCursorSql(linkedServerId: string, recovery: AdmRecoveryPlan) {
  const columns = await getColumns("adm_sync_state");
  const admFile = recovery.admFile ?? requestedAdmFile ?? DEFAULT_ADM_FILE;
  const admPath = recovery.admPath ?? admFile;
  const values = new Map<string, unknown>([
    ["id", `repair-adm-state-${linkedServerId}`],
    ["linked_server_id", linkedServerId],
    ["latest_adm_file", admFile],
    ["latest_adm_path", admPath],
    ["last_processed_file", admFile],
    ["last_processed_line", recovery.linesScanned],
    ["last_processed_offset", 0],
    ["last_sync_status", "completed"],
    ["last_sync_message", `Re-added server repair inserted ${recovery.missingKills.length} missing kills`],
    ["last_sync_at", "CURRENT_TIMESTAMP"],
    ["last_lines_read", recovery.linesScanned],
    ["last_lines_processed", recovery.linesScanned],
    ["last_kills_created", recovery.missingKills.length],
    ["last_events_created", recovery.missingKills.length],
    ["updated_at", "CURRENT_TIMESTAMP"],
  ]);
  const insertColumns = [...values.keys()].filter((column) => columns.has(column));
  const insertValues = insertColumns.map((column) => {
    const value = values.get(column);
    return value === "CURRENT_TIMESTAMP" ? "CURRENT_TIMESTAMP" : sqlValue(value);
  });
  const updateColumns = insertColumns.filter((column) => column !== "id" && column !== "linked_server_id");
  const updates = updateColumns.map((column) => {
    const value = values.get(column);
    return value === "CURRENT_TIMESTAMP" ? `${column} = CURRENT_TIMESTAMP` : `${column} = excluded.${column}`;
  });
  return `INSERT INTO adm_sync_state (${insertColumns.join(", ")})
          VALUES (${insertValues.join(", ")})
          ON CONFLICT(linked_server_id) DO UPDATE SET ${updates.join(", ")}`;
}

async function tryLoadNitradoToken(linkedServer: ServerSummary): Promise<{ token: string; source: TokenSource } | null> {
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
  const rows = await d1Query<TokenRow>(
    `SELECT encrypted_token, token_iv, token_auth_tag
     FROM nitrado_connections
     WHERE linked_server_id = ${sqlString(linkedServerId)} AND user_id = ${sqlString(userId)}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

function countCandidatePlayers(candidates: KillCandidate[]) {
  const players = new Set<string>();
  for (const candidate of candidates) {
    const killer = candidate.parsed.killerId ?? candidate.parsed.killerName ?? candidate.parsed.playerId ?? candidate.parsed.playerName;
    const victim = candidate.parsed.victimId ?? candidate.parsed.victimName;
    if (killer) players.add(`killer:${killer.toLowerCase()}`);
    if (victim) players.add(`victim:${victim.toLowerCase()}`);
  }
  return players.size;
}

function findDuplicateKillIds(killRows: KillRow[], canonicalId: string) {
  const bestByKey = new Map<string, KillRow>();
  const duplicateIds: string[] = [];
  for (const row of killRows) {
    const key = killKey(row);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, row);
      continue;
    }
    const preferCurrent = existing.linked_server_id !== canonicalId && row.linked_server_id === canonicalId;
    if (preferCurrent) {
      duplicateIds.push(existing.id);
      bestByKey.set(key, row);
    } else {
      duplicateIds.push(row.id);
    }
  }
  return duplicateIds;
}

function countUniqueKills(killRows: KillRow[]) {
  return new Set(killRows.map(killKey)).size;
}

function killKey(row: KillRow) {
  const lineKey = row.adm_file && row.line_number ? `${row.adm_file}:${row.line_number}` : "";
  if (lineKey) return `line:${lineKey}`;
  return [
    "event",
    row.occurred_at ?? "",
    row.killer_id ?? lower(row.killer_name),
    row.victim_id ?? lower(row.victim_name),
    row.weapon ?? "",
    Number(row.distance ?? 0).toFixed(3),
  ].join("|");
}

function buildSchemaSql(existingColumns: Set<string>) {
  const statements = [];
  if (!existingColumns.has("merged_into_server_id")) statements.push("ALTER TABLE linked_servers ADD COLUMN merged_into_server_id TEXT");
  if (!existingColumns.has("merged_at")) statements.push("ALTER TABLE linked_servers ADD COLUMN merged_at TEXT");
  statements.push("CREATE INDEX IF NOT EXISTS idx_linked_servers_nitrado_service_canonical ON linked_servers(nitrado_service_id, merged_into_server_id, status)");
  return statements.join(";\n");
}

function buildDeleteDuplicateKillsSql(ids: string[]) {
  if (!ids.length) return "";
  return `DELETE FROM kill_events WHERE id IN (${sqlList(ids)})`;
}

async function buildUniqueStateSql(rows: ServerSummary[], canonicalId: string) {
  const duplicateIds = rows.filter((row) => row.id !== canonicalId).map((row) => row.id);
  const allIds = rows.map((row) => row.id);
  const statements: string[] = [];
  const admState = await selectBestAdmSyncState(allIds);
  if (admState) {
    statements.push(buildAdmStateUpsert(admState, canonicalId));
  }
  statements.push(
    `INSERT OR IGNORE INTO server_log_config (id, linked_server_id, adm_path, created_at, updated_at)
     SELECT ${sqlString(`repair-log-config-${canonicalId}`)}, ${sqlString(canonicalId)}, adm_path, created_at, updated_at
     FROM server_log_config
     WHERE linked_server_id IN (${sqlList(allIds)})
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  );
  if (duplicateIds.length) {
    statements.push(`DELETE FROM adm_sync_state WHERE linked_server_id IN (${sqlList(duplicateIds)})`);
    statements.push(`DELETE FROM server_log_config WHERE linked_server_id IN (${sqlList(duplicateIds)})`);
    statements.push(`DELETE FROM server_stats WHERE linked_server_id IN (${sqlList(duplicateIds)})`);
  }
  return statements.join(";\n");
}

async function selectBestAdmSyncState(serverIds: string[]) {
  const rows = await d1Query<Record<string, unknown>>(
    `SELECT *
     FROM adm_sync_state
     WHERE linked_server_id IN (${sqlList(serverIds)})
     ORDER BY COALESCE(last_processed_line, 0) DESC, datetime(COALESCE(last_sync_at, updated_at, created_at)) DESC
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

function buildAdmStateUpsert(row: Record<string, unknown>, canonicalId: string) {
  const columns = Object.keys(row).filter((column) => column !== "id" && column !== "linked_server_id");
  const insertColumns = ["id", "linked_server_id", ...columns];
  const values = [`${sqlString(`repair-adm-state-${canonicalId}`)}`, sqlString(canonicalId), ...columns.map((column) => sqlValue(row[column]))];
  const updates = columns.map((column) => `${column} = excluded.${column}`);
  updates.push("updated_at = CURRENT_TIMESTAMP");
  return `INSERT INTO adm_sync_state (${insertColumns.join(", ")})
          VALUES (${values.join(", ")})
          ON CONFLICT(linked_server_id) DO UPDATE SET ${updates.join(", ")}`;
}

async function buildMoveChildrenSql(duplicateIds: string[], canonicalId: string) {
  if (!duplicateIds.length) return "";
  const ids = sqlList(duplicateIds);
  const statements = [
    `UPDATE adm_raw_events SET linked_server_id = ${sqlString(canonicalId)} WHERE linked_server_id IN (${ids})`,
    `UPDATE player_events SET linked_server_id = ${sqlString(canonicalId)} WHERE linked_server_id IN (${ids})`,
    `UPDATE kill_events SET linked_server_id = ${sqlString(canonicalId)} WHERE linked_server_id IN (${ids})`,
    `UPDATE player_profiles SET linked_server_id = ${sqlString(canonicalId)}, updated_at = CURRENT_TIMESTAMP WHERE linked_server_id IN (${ids})`,
    `DELETE FROM player_profiles
     WHERE linked_server_id = ${sqlString(canonicalId)}
       AND id NOT IN (
         SELECT MIN(id)
         FROM player_profiles
         WHERE linked_server_id = ${sqlString(canonicalId)}
         GROUP BY COALESCE(player_id, lower(player_name))
       )`,
    `UPDATE sync_runs SET linked_server_id = ${sqlString(canonicalId)} WHERE linked_server_id IN (${ids})`,
    `UPDATE nitrado_connections SET linked_server_id = ${sqlString(canonicalId)}, updated_at = CURRENT_TIMESTAMP WHERE linked_server_id IN (${ids})`,
    `UPDATE onboarding_checks SET linked_server_id = ${sqlString(canonicalId)} WHERE linked_server_id IN (${ids})`,
    `UPDATE linked_servers SET status = 'merged', public_slug = NULL, merged_into_server_id = ${sqlString(canonicalId)}, merged_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ids})`,
  ];

  if (await tableExists("server_metadata_versions")) {
    const columns = await getColumns("server_metadata_versions");
    const serverColumn = columns.has("linked_server_id") ? "linked_server_id" : columns.has("server_id") ? "server_id" : null;
    if (serverColumn) statements.push(`UPDATE server_metadata_versions SET ${serverColumn} = ${sqlString(canonicalId)} WHERE ${serverColumn} IN (${ids})`);
  }

  if (await tableExists("server_slug_aliases")) {
    const columns = await getColumns("server_slug_aliases");
    const serverColumn = columns.has("linked_server_id") ? "linked_server_id" : columns.has("server_id") ? "server_id" : null;
    if (serverColumn) statements.push(`UPDATE server_slug_aliases SET ${serverColumn} = ${sqlString(canonicalId)} WHERE ${serverColumn} IN (${ids})`);
  }

  return statements.join(";\n");
}

function buildRebuildSql(canonicalId: string, metadataSource?: ServerSummary, targetSlug?: string, duplicateIds: string[] = []) {
  const playerKey = "COALESCE(player_id, lower(player_name))";
  const metadataAssignments = metadataSource
    ? [
        `user_id = ${sqlValue(metadataSource.user_id)}`,
        `guild_id = ${sqlValue(metadataSource.guild_id)}`,
        `discord_guild_id = ${sqlValue(metadataSource.discord_guild_id)}`,
        `nitrado_service_name = COALESCE(${sqlValue(metadataSource.nitrado_service_name)}, nitrado_service_name)`,
        `server_name = COALESCE(${sqlValue(metadataSource.server_name)}, server_name)`,
        `display_name = COALESCE(${sqlValue(metadataSource.display_name)}, display_name)`,
        `hostname = COALESCE(${sqlValue(metadataSource.hostname)}, hostname)`,
        `status = 'live'`,
        `public_slug = ${sqlString(targetSlug ?? metadataSource.public_slug ?? toPublicSlug(firstString(metadataSource.display_name, metadataSource.hostname, metadataSource.server_name, metadataSource.nitrado_service_name) ?? "dayz-server"))}`,
        `merged_into_server_id = NULL`,
        `merged_at = NULL`,
        `updated_at = CURRENT_TIMESTAMP`,
      ]
    : [`updated_at = CURRENT_TIMESTAMP`];

  return `
    INSERT INTO player_profiles (id, linked_server_id, player_name, player_id, kills, deaths, longest_kill_distance, first_seen_at, created_at, updated_at)
    SELECT 'repair-profile-' || lower(hex(randomblob(16))), ${sqlString(canonicalId)}, player_name, player_id, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM (
      SELECT killer_name AS player_name, killer_id AS player_id, COALESCE(killer_id, lower(killer_name)) AS player_key
      FROM kill_events
      WHERE linked_server_id = ${sqlString(canonicalId)} AND killer_name IS NOT NULL
      UNION
      SELECT victim_name AS player_name, victim_id AS player_id, COALESCE(victim_id, lower(victim_name)) AS player_key
      FROM kill_events
      WHERE linked_server_id = ${sqlString(canonicalId)} AND victim_name IS NOT NULL
    ) AS players
    WHERE player_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM player_profiles
        WHERE linked_server_id = ${sqlString(canonicalId)}
          AND COALESCE(player_id, lower(player_name)) = players.player_key
      );

    UPDATE player_profiles
    SET
      kills = (
        SELECT COUNT(*) FROM kill_events
        WHERE linked_server_id = ${sqlString(canonicalId)}
          AND COALESCE(killer_id, lower(killer_name)) = ${playerKey}
      ),
      deaths = (
        SELECT COUNT(*) FROM kill_events
        WHERE linked_server_id = ${sqlString(canonicalId)}
          AND COALESCE(victim_id, lower(victim_name)) = ${playerKey}
      ),
      longest_kill_distance = COALESCE((
        SELECT MAX(distance) FROM kill_events
        WHERE linked_server_id = ${sqlString(canonicalId)}
          AND COALESCE(killer_id, lower(killer_name)) = ${playerKey}
      ), 0),
      last_seen_at = (
        SELECT MAX(event_time) FROM (
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM kill_events
          WHERE linked_server_id = ${sqlString(canonicalId)}
            AND (COALESCE(killer_id, lower(killer_name)) = ${playerKey} OR COALESCE(victim_id, lower(victim_name)) = ${playerKey})
          UNION ALL
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM player_events
          WHERE linked_server_id = ${sqlString(canonicalId)}
            AND COALESCE(player_id, lower(player_name)) = ${playerKey}
        )
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE linked_server_id = ${sqlString(canonicalId)};

    INSERT INTO server_stats (id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects, unique_players, last_event_at, updated_at)
    VALUES (
      ${sqlString(`server-stats-${canonicalId}`)},
      ${sqlString(canonicalId)},
      (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(canonicalId)}),
      (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sqlString(canonicalId)} AND victim_name IS NOT NULL),
      (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(canonicalId)} AND event_type = 'player_connected'),
      (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sqlString(canonicalId)} AND event_type = 'player_disconnected'),
      (
        SELECT COUNT(DISTINCT player_key) FROM (
          SELECT COALESCE(killer_id, lower(killer_name)) AS player_key FROM kill_events WHERE linked_server_id = ${sqlString(canonicalId)} AND killer_name IS NOT NULL
          UNION
          SELECT COALESCE(victim_id, lower(victim_name)) AS player_key FROM kill_events WHERE linked_server_id = ${sqlString(canonicalId)} AND victim_name IS NOT NULL
          UNION
          SELECT COALESCE(player_id, lower(player_name)) AS player_key FROM player_events WHERE linked_server_id = ${sqlString(canonicalId)} AND player_name IS NOT NULL
        )
      ),
      (
        SELECT MAX(event_time) FROM (
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM kill_events WHERE linked_server_id = ${sqlString(canonicalId)}
          UNION ALL
          SELECT COALESCE(occurred_at, created_at) AS event_time FROM player_events WHERE linked_server_id = ${sqlString(canonicalId)}
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

    ${duplicateIds.length ? `UPDATE linked_servers SET public_slug = NULL WHERE id IN (${sqlList(duplicateIds)});` : ""}
    UPDATE linked_servers
    SET ${metadataAssignments.join(",\n        ")}
    WHERE id = ${sqlString(canonicalId)};
  `;
}

async function runSqlPhase(sqlCommand: string, phase: ApplyPhase) {
  if (!sqlCommand.trim()) return;
  const dir = mkdtempSync(join(tmpdir(), "dzn-readded-server-repair-"));
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

async function getColumns(table: string) {
  const rows = await d1Query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

async function tableExists(table: string) {
  const rows = await d1Query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(table)} LIMIT 1`);
  return Boolean(rows[0]);
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
  console.error(`Repair SQL file kept for debugging:\n${sqlFilePath}`);
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

function parsedFallbackKey(event: ParsedAdmEvent) {
  return [
    event.occurredAt ?? "",
    event.killerId ?? event.killerName ?? event.playerId ?? event.playerName ?? "",
    event.victimId ?? event.victimName ?? "",
    event.weapon ?? "",
    normalizeDistance(event.distance),
  ].join("|").toLowerCase();
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

function isNitradoTokenRejected(diagnostics: NitradoLogAccessDiagnostics) {
  return diagnostics.attempts.some(
    (attempt) =>
      attempt.status === "401" ||
      attempt.httpStatusCode === 401 ||
      /token was rejected|unauthorized|invalid token/i.test(attempt.safeErrorMessage ?? ""),
  );
}

function isNitradoTokenError(error: unknown) {
  return error instanceof Error && /401|unauthorized|invalid_token|invalid token|token was rejected/i.test(error.message);
}

function normalizeDistance(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : "";
}

function sameAdmFile(actual: string | null, requested: string | null) {
  if (!actual || !requested) return false;
  return basename(actual).toLowerCase() === basename(requested).toLowerCase();
}

function splitLocalAdmLines(content: string) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

async function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  return stableSyncIdSync(prefix, linkedServerId, admFile, lineNumber, suffix);
}

function stableSyncIdSync(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  const hash = createHash("sha256").update(input).digest("hex");
  return `${prefix}:${hash.slice(0, 48)}`;
}

function extractAdmDate(fileName: string | null) {
  return fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null : null;
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

function lower(value: string | null | undefined) {
  return value?.toLowerCase() ?? "";
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function toPublicSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || `server-${Date.now()}`;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function fail(message: string): never {
  throw new Error(message);
}
