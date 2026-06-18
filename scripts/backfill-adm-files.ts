import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import { parseAdmLines, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { classifyParsedBuildEvent } from "../functions/_lib/build-events";
import { OWNER_SUPPLIED_ADM_RECOVERY_SOURCE, previewManualAdmText } from "../functions/_lib/adm-sync";

const DATABASE_NAME = "dzn_network_db";
const DEFAULT_CHUNK_SIZE = 100;

type Mode = "dry-run" | "apply";

type Args = {
  flags: Set<string>;
  values: Map<string, string>;
};

type LinkedServerRow = {
  id: string;
  nitrado_service_id: string | number | null;
  guild_id: string | null;
  display_name: string | null;
  server_name: string | null;
  hostname: string | null;
  nitrado_service_name: string | null;
};

type ExistingKillRow = {
  id: string;
  occurred_at: string | null;
  killer_id: string | null;
  killer_name: string | null;
  victim_id: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  source_adm_file: string | null;
  adm_file: string | null;
  source_line_number: number | null;
  line_number: number | null;
};

type PlannedAdmFile = {
  path: string;
  filename: string;
  sha256: string;
  rawText: string;
  lines: string[];
  parsed: ParsedAdmEvent[];
  preview: ReturnType<typeof previewManualAdmText>;
  counts: AdmFileCounts;
  jobId: string;
};

type AdmFileCounts = {
  rawLines: number;
  parsedKills: number;
  playerEvents: number;
  buildEvents: number;
  environmentalDeaths: number;
  connections: number;
  disconnections: number;
  playerListEvents: number;
  hitLines: number;
  ignoredLines: number;
  parseErrors: number;
};

type FileDedupSummary = {
  filename: string;
  sha256: string;
  parsedKills: number;
  parsedPlayerEvents: number;
  parsedBuildEvents: number;
  exactSourceKillsPresent: number;
  fallbackKillMatchesPresent: number;
  missingKills: number;
  duplicateKillsWithinBundle: number;
  existingPlayerEventsBySource: number;
  existingBuildEventsBySource: number;
};

const args = parseArgs(process.argv.slice(2));
const mode: Mode = args.flags.has("apply") ? "apply" : "dry-run";
const serverId = valueArg(args, "server-id");
const serviceId = valueArg(args, "service-id");
const inputPath = valueArg(args, "input");
const confirmServiceId = valueArg(args, "confirm-service-id");
const useRemote = args.flags.has("remote");

main().catch((error) => {
  console.error("ADM recovery backfill failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  if (!serverId) fail("Missing --server-id.");
  if (!serviceId) fail("Missing --service-id.");
  if (!inputPath) fail("Missing --input.");
  if (mode === "apply" && (!useRemote || confirmServiceId !== serviceId)) {
    fail("Production apply requires --remote --apply and --confirm-service-id matching --service-id.");
  }

  const files = await loadAdmFiles(inputPath);
  if (!files.length) fail(`No ADM files found under ${inputPath}.`);

  printParserSummary(files);

  let server: LinkedServerRow | null = null;
  let dedupe: FileDedupSummary[] = [];
  if (useRemote) {
    server = await loadRemoteServer(serverId);
    const remoteServiceId = String(server.nitrado_service_id ?? "");
    if (!remoteServiceId || remoteServiceId !== serviceId) {
      fail(`Server/service mismatch. Server ${serverId} is linked to service ${remoteServiceId || "unknown"}, not ${serviceId}.`);
    }
    dedupe = await buildRemoteDedupSummary(files);
    printRemoteDedupSummary(dedupe);
  }

  if (mode === "dry-run") {
    console.log("");
    console.log("Dry run only. No database changes made.");
    if (!useRemote) console.log("Remote dedupe was not checked. Add --remote for production comparison.");
    return;
  }

  if (!server) fail("Remote server verification was not completed.");
  await queueRecoveryJobs(files);
  console.log("");
  console.log("Queued owner-supplied ADM recovery jobs.");
  console.log(`Source: ${OWNER_SUPPLIED_ADM_RECOVERY_SOURCE}`);
  console.log(`Files queued: ${files.length}`);
  console.log("The ADM Worker will process these jobs through the canonical chunk importer.");
}

function parseArgs(values: string[]): Args {
  const flags = new Set<string>();
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, values: parsed };
}

function valueArg(parsed: Args, key: string) {
  const value = parsed.values.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadAdmFiles(rootPath: string): Promise<PlannedAdmFile[]> {
  const resolved = resolve(rootPath);
  if (!existsSync(resolved)) fail(`Input path does not exist: ${resolved}`);
  const paths = statSync(resolved).isDirectory()
    ? await collectAdmPaths(resolved)
    : [resolved];
  const files = paths
    .filter((path) => extname(path).toLowerCase() === ".adm")
    .map(loadAdmFile)
    .sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

async function collectAdmPaths(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await collectAdmPaths(fullPath));
    } else if (entry.isFile()) {
      paths.push(fullPath);
    }
  }
  return paths;
}

function loadAdmFile(path: string): PlannedAdmFile {
  const filename = basename(path);
  if (!/^DayZServer_PS4_x64_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.ADM$/i.test(filename)) {
    fail(`Refusing malformed ADM filename: ${filename}`);
  }
  const rawText = readFileSync(path, "utf8");
  if (!rawText.trim()) fail(`Refusing empty ADM file: ${filename}`);
  if (!looksLikeAdmText(rawText)) fail(`Refusing file that does not look like ADM text: ${filename}`);
  const lines = splitAdmText(rawText);
  const parsed = parseAdmLines(lines, { admDate: extractAdmDate(filename) ?? undefined });
  const preview = previewManualAdmText({ filename, admText: rawText });
  const sha256 = createHash("sha256").update(rawText).digest("hex");
  return {
    path,
    filename,
    sha256,
    rawText,
    lines,
    parsed,
    preview,
    counts: countAdmEvents(lines, parsed),
    jobId: `adm-recovery-${createHash("sha256").update(`${serverId}:${serviceId}:${filename}:${sha256}`).digest("hex").slice(0, 48)}`,
  };
}

function looksLikeAdmText(value: string) {
  return /AdminLog started on \d{4}-\d{2}-\d{2}/i.test(value) || /\d{1,2}:\d{2}(?::\d{2})?\s+\|\s+Player\s+"/i.test(value);
}

function splitAdmText(value: string) {
  return value.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
}

function countAdmEvents(lines: string[], parsed: ParsedAdmEvent[]): AdmFileCounts {
  const parsedKills = parsed.filter(isCreditedKill).length;
  return {
    rawLines: lines.length,
    parsedKills,
    playerEvents: parsed.filter(isStoredPlayerEvent).length,
    buildEvents: parsed.map((event) => classifyParsedBuildEvent(event)).filter(Boolean).length,
    environmentalDeaths: parsed.filter((event) => event.eventType === "player_died_stats" || event.eventType === "player_killed_environment").length,
    connections: parsed.filter((event) => event.eventType === "player_connected" || event.eventType === "player_connecting").length,
    disconnections: parsed.filter((event) => event.eventType === "player_disconnected").length,
    playerListEvents: parsed.filter((event) => event.eventType === "playerlist_snapshot" || event.eventType === "playerlist_entry").length,
    hitLines: parsed.filter((event) => String(event.eventType).startsWith("player_hit")).length,
    ignoredLines: parsed.filter((event) => event.eventType === "unknown" || event.eventType === "playerlist_delimiter").length,
    parseErrors: Math.max(0, lines.filter(hasRawPlayerKillLine).length - parsedKills),
  };
}

function isCreditedKill(event: ParsedAdmEvent) {
  return event.eventType === "player_killed" && event.isCreditedKill === true;
}

function isStoredPlayerEvent(event: ParsedAdmEvent) {
  if (isCreditedKill(event)) return false;
  if (String(event.eventType).startsWith("player_hit")) return false;
  return [
    "player_connected",
    "player_connecting",
    "player_disconnected",
    "player_suicide",
    "player_killed_environment",
    "player_died_stats",
    "player_unconscious",
    "player_regained_consciousness",
    "playerlist_entry",
    "plain_player_state",
  ].includes(event.eventType);
}

function hasRawPlayerKillLine(line: string) {
  return /killed by Player/i.test(line);
}

function printParserSummary(files: PlannedAdmFile[]) {
  console.log("ADM recovery parser dry run");
  console.log(`Mode: ${mode}`);
  console.log(`Remote: ${useRemote ? "yes" : "no"}`);
  console.log(`Server ID: ${serverId}`);
  console.log(`Service ID: ${serviceId}`);
  console.log(`Files: ${files.length}`);
  let totalKills = 0;
  for (const file of files) {
    totalKills += file.counts.parsedKills;
    console.log(`${file.filename}: lines=${file.counts.rawLines} kills=${file.counts.parsedKills} player_events=${file.counts.playerEvents} build_events=${file.counts.buildEvents} hits=${file.counts.hitLines} sha256=${file.sha256}`);
  }
  console.log(`Total parsed killed-by-player events: ${totalKills}`);
}

async function loadRemoteServer(id: string) {
  const rows = await d1Query<LinkedServerRow>(
    `SELECT id, nitrado_service_id, guild_id, display_name, server_name, hostname, nitrado_service_name
     FROM linked_servers
     WHERE id = ${sql(id)}
     LIMIT 1`,
  );
  const server = rows[0];
  if (!server?.id) fail(`Unknown linked server: ${id}`);
  return server;
}

async function buildRemoteDedupSummary(files: PlannedAdmFile[]) {
  const allKillKeys = new Map<string, number>();
  for (const file of files) {
    for (const kill of file.parsed.filter(isCreditedKill)) {
      const key = killFallbackKey(kill);
      allKillKeys.set(key, (allKillKeys.get(key) ?? 0) + 1);
    }
  }

  const summaries: FileDedupSummary[] = [];
  for (const file of files) {
    const kills = file.parsed.filter(isCreditedKill);
    const existingSourceKills = await countSourceRows("kill_events", file.filename);
    const existingPlayerEvents = await countSourceRows("player_events", file.filename);
    const existingBuildEvents = await countSourceRows("build_events", file.filename);
    const fallbackMatches = await countFallbackKillMatches(kills);
    const duplicateWithinBundle = kills.filter((kill) => (allKillKeys.get(killFallbackKey(kill)) ?? 0) > 1).length;
    summaries.push({
      filename: file.filename,
      sha256: file.sha256,
      parsedKills: kills.length,
      parsedPlayerEvents: file.counts.playerEvents,
      parsedBuildEvents: file.counts.buildEvents,
      exactSourceKillsPresent: existingSourceKills,
      fallbackKillMatchesPresent: fallbackMatches,
      missingKills: Math.max(0, kills.length - fallbackMatches),
      duplicateKillsWithinBundle: duplicateWithinBundle,
      existingPlayerEventsBySource: existingPlayerEvents,
      existingBuildEventsBySource: existingBuildEvents,
    });
  }
  return summaries;
}

async function countSourceRows(table: "kill_events" | "player_events" | "build_events", filename: string) {
  const sourceColumn = table === "build_events" ? "nitrado_service_id" : "source_service_id";
  const rows = await d1Query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM ${table}
     WHERE linked_server_id = ${sql(serverId)}
       AND COALESCE(${sourceColumn}, ${sql(serviceId)}) = ${sql(serviceId)}
       AND COALESCE(source_adm_file, ${table === "build_events" ? "source_adm_file" : "adm_file"}, '') = ${sql(filename)}`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function countFallbackKillMatches(kills: ParsedAdmEvent[]) {
  if (!kills.length) return 0;
  const times = kills.map((kill) => kill.occurredAt).filter(Boolean).sort() as string[];
  const start = times[0] ?? "1970-01-01T00:00:00.000Z";
  const end = times[times.length - 1] ?? "9999-12-31T23:59:59.999Z";
  const rows = await d1Query<ExistingKillRow>(
    `SELECT id, occurred_at, killer_id, killer_name, victim_id, victim_name, weapon, distance, source_adm_file, adm_file, source_line_number, line_number
     FROM kill_events
     WHERE linked_server_id = ${sql(serverId)}
       AND COALESCE(source_service_id, ${sql(serviceId)}) = ${sql(serviceId)}
       AND COALESCE(occurred_at, '') >= ${sql(start)}
       AND COALESCE(occurred_at, '') <= ${sql(end)}`,
  );
  const existing = new Set(rows.map(killRowFallbackKey));
  return kills.filter((kill) => existing.has(killFallbackKey(kill))).length;
}

function printRemoteDedupSummary(summaries: FileDedupSummary[]) {
  console.log("");
  console.log("Production dedupe dry run");
  let missing = 0;
  for (const summary of summaries) {
    missing += summary.missingKills;
    console.log(`${summary.filename}: parsed_kills=${summary.parsedKills} fallback_present=${summary.fallbackKillMatchesPresent} exact_source_present=${summary.exactSourceKillsPresent} missing_kills=${summary.missingKills} duplicate_kills_within_bundle=${summary.duplicateKillsWithinBundle}`);
  }
  console.log(`Proposed missing killed-by-player events: ${missing}`);
}

async function queueRecoveryJobs(files: PlannedAdmFile[]) {
  const tmp = mkdtempSync(join(tmpdir(), "dzn-adm-recovery-"));
  const sqlPath = join(tmp, "queue-recovery.sql");
  try {
    const statements = files.map(buildQueueJobSql);
    writeFileSync(sqlPath, statements.join("\n\n"), "utf8");
    runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--file", sqlPath]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function buildQueueJobSql(file: PlannedAdmFile) {
  const audit = {
    source_type: OWNER_SUPPLIED_ADM_RECOVERY_SOURCE,
    source_filename: file.filename,
    source_sha256: file.sha256,
    parser_raw_kill_lines: file.preview.raw_kill_lines_found,
    parser_pvp_kills: file.preview.parsed_kills,
    production_commit: currentGitCommit(),
  };
  const totalChunks = Math.max(1, Math.ceil(file.lines.length / DEFAULT_CHUNK_SIZE));
  return `INSERT INTO adm_import_jobs (
    id, server_id, source_service_id, filename, source, status, adm_text,
    total_lines, current_line, chunk_size, total_chunks, chunks_processed,
    import_hit_lines, raw_kill_lines_found, last_chunk_index, failed_chunk_index,
    parsed_kills, written_kills, duplicate_skips, joins, disconnects,
    playerlist_snapshots, deaths, suicides, uncredited_deaths, hit_lines,
    raw_events, player_events, failed_writes, public_cache_updated,
    discord_jobs_queued, warnings_json, error_message, result_json, created_at, updated_at
  )
  SELECT
    ${sql(file.jobId)}, ${sql(serverId)}, ${sql(serviceId)}, ${sql(file.filename)}, ${sql(OWNER_SUPPLIED_ADM_RECOVERY_SOURCE)},
    'queued', ${sql(file.rawText)}, ${file.lines.length}, 0, ${DEFAULT_CHUNK_SIZE}, ${totalChunks}, 0,
    0, 0, -1, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ${sql(JSON.stringify([audit]))}, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM adm_import_jobs
    WHERE server_id = ${sql(serverId)}
      AND source = ${sql(OWNER_SUPPLIED_ADM_RECOVERY_SOURCE)}
      AND filename = ${sql(file.filename)}
      AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable', 'completed', 'completed_with_warnings')
  );`;
}

function killFallbackKey(event: ParsedAdmEvent) {
  return [
    event.occurredAt ?? "",
    event.killerId ?? event.killerName ?? event.playerId ?? event.playerName ?? "",
    event.victimId ?? event.victimName ?? "",
    event.weapon ?? "",
    normalizeDistance(event.distance),
  ].join("|");
}

function killRowFallbackKey(row: ExistingKillRow) {
  return [
    row.occurred_at ?? "",
    row.killer_id ?? row.killer_name ?? "",
    row.victim_id ?? row.victim_name ?? "",
    row.weapon ?? "",
    normalizeDistance(row.distance),
  ].join("|");
}

function normalizeDistance(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : "";
}

function extractAdmDate(filename: string) {
  return filename.match(/DayZServer_PS4_x64_(\d{4}-\d{2}-\d{2})_/i)?.[1] ?? null;
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--command", compactSql(sqlCommand)]);
  const parsed = JSON.parse(output) as Array<{ results?: T[]; success?: boolean; error?: string }>;
  const first = parsed[0];
  if (!first?.success) fail(first?.error ?? "Remote D1 query failed.");
  return first.results ?? [];
}

function runWrangler(argsValue: string[]) {
  const wranglerBin = require.resolve("wrangler/bin/wrangler.js");
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  };
  try {
    return execFileSync(process.execPath, [wranglerBin, ...argsValue], options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Wrangler command failed: ${message}`);
  }
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function compactSql(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sql(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
