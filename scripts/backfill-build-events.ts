/**
 * ONE-TIME BUILD EVENT BACKFILL SCRIPT
 *
 * This script is not part of normal DZN sync.
 * It scans an ADM file for build/placement activity, inserts missing build_events
 * only when --apply is used, rebuilds server_build_stats, then exits.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { parseAdmLines, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { classifyParsedBuildEvent, summarizeBuildStats, type ParsedBuildActivity } from "../functions/_lib/build-events";
import { decryptToken } from "../functions/_lib/crypto";
import { fetchReadableNitradoAdmLines, type NitradoLogAccessDiagnostics } from "../functions/_lib/nitrado";

const DATABASE_NAME = "dzn_network_db";
const LOCAL_TOKEN_FILE = ".local-nitrado-token";

type Mode = "dry-run" | "apply";
type TokenSource = "environment/direct" | "stored" | "local file";

type LinkedServerRow = {
  id: string;
  user_id: string;
  nitrado_service_id: string | null;
};

type TokenRow = {
  encrypted_token: string;
  token_iv: string;
  token_auth_tag: string;
};

type ExistingBuildRow = {
  nitrado_service_id: string;
  source_adm_file: string;
  source_line_number: number;
};

type BuildCandidate = {
  parsed: ParsedAdmEvent;
  build: ParsedBuildActivity;
  lineNumber: number;
  id: string;
};

loadEnvFiles();

const args = parseArgs(process.argv.slice(2));
const mode = resolveMode(args);
const serviceId = stringArg(args, "service-id") ?? fail("Missing --service-id. Example: npm run backfill:build-events -- --service-id 17428528 --dry-run");
const localAdmPath = stringArg(args, "adm-local");
const requestedAdmFile = stringArg(args, "adm-file");

main().catch((error) => {
  console.error("Build event backfill failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const linkedServer = await findLinkedServer(serviceId);
  const readable = await readAdmLines(linkedServer);
  const admFile = requestedAdmFile ?? readable.admFile;
  const parsed = parseAdmLines(readable.lines, { admDate: extractAdmDate(admFile) ?? undefined });
  const candidates = await buildCandidates(parsed, linkedServer.id, admFile);
  const existingKeys = new Set((await getExistingBuildRows(serviceId, admFile)).map(buildDedupeKey));
  const missing = candidates.filter((candidate) => !existingKeys.has(`${serviceId}:${admFile}:${candidate.lineNumber}`));
  const summary = summarizeBuildStats(candidates.map((candidate) => candidate.build));
  const placedEventsFound = candidates.filter((candidate) => candidate.build.eventType === "placed").length;
  const builtEventsFound = candidates.filter((candidate) => candidate.build.eventType === "built").length;

  printPlan({
    mode,
    serviceId,
    linkedServerId: linkedServer.id,
    admFile,
    source: readable.source,
    linesScanned: readable.lines.length,
    placedEventsFound,
    builtEventsFound,
    eventsFound: candidates.length,
    missingEvents: missing.length,
    structuresBuilt: summary.structuresBuilt,
    buildItemsPlaced: summary.buildItemsPlaced,
    storageItemsPlaced: summary.storageItemsPlaced,
    trapsPlaced: summary.trapsPlaced,
    buildScore: summary.buildScore,
  });

  if (mode === "dry-run") return;

  await applyBuildBackfill(linkedServer, admFile, missing);
  console.log("");
  console.log("DZN BUILD EVENT BACKFILL COMPLETE");
  console.log(`Service ID: ${serviceId}`);
  console.log(`ADM file: ${admFile}`);
  console.log(`New build events inserted: ${missing.length}`);
  console.log("Server build totals rebuilt.");
}

async function readAdmLines(linkedServer: LinkedServerRow): Promise<{ lines: string[]; admFile: string; source: string }> {
  if (localAdmPath) {
    if (!existsSync(localAdmPath)) fail(`ADM local file not found: ${localAdmPath}`);
    return {
      lines: readFileSync(localAdmPath, "utf8").split(/\r?\n/).filter(Boolean),
      admFile: requestedAdmFile ?? basename(localAdmPath),
      source: "local file",
    };
  }

  const tokenSource = await loadNitradoToken(linkedServer);
  const readable = await fetchReadableNitradoAdmLines(tokenSource.token, serviceId, {
    mode: "full",
    preferredAdmFileName: requestedAdmFile ?? undefined,
  }).catch((error) => {
    if (isNitradoTokenError(error)) fail("Nitrado token was rejected. Please check the token and try again.");
    throw error;
  });
  if (isNitradoTokenRejected(readable.diagnostics)) fail("Nitrado token was rejected. Please check the token and try again.");
  if (!readable.lines.length) fail(readable.diagnostics.readable.message || "No readable ADM lines were returned by Nitrado.");
  return {
    lines: readable.lines,
    admFile: readable.diagnostics.newestAdmFileName ?? requestedAdmFile ?? "unknown-adm",
    source: tokenSource.source,
  };
}

async function buildCandidates(parsed: ParsedAdmEvent[], linkedServerId: string, admFile: string) {
  const candidates: BuildCandidate[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const event = parsed[index];
    const build = classifyParsedBuildEvent(event);
    if (!build) continue;
    const lineNumber = index + 1;
    candidates.push({
      parsed: event,
      build,
      lineNumber,
      id: await stableSyncId("build-event", linkedServerId, admFile, lineNumber),
    });
  }
  return candidates;
}

async function applyBuildBackfill(linkedServer: LinkedServerRow, admFile: string, missing: BuildCandidate[]) {
  const migration = readFileSync(join(process.cwd(), "migrations", "0011_build_events_and_event_stats.sql"), "utf8");
  const inserts = missing.map((candidate) => buildInsertSql(linkedServer, admFile, candidate)).join("\n");
  const rebuild = buildRebuildSql(linkedServer.id, serviceId);
  await d1ExecuteFile([migration, inserts, rebuild].filter(Boolean).join("\n\n"));
}

function buildInsertSql(linkedServer: LinkedServerRow, admFile: string, candidate: BuildCandidate) {
  const position = candidate.parsed.position;
  return `INSERT OR IGNORE INTO build_events (
    id, linked_server_id, nitrado_service_id, player_id, player_name, event_type,
    build_part, target_object, tool, placed_object, placed_class, pos_x, pos_y, pos_z,
    source_adm_file, source_line_number, occurred_at, raw_line, created_at
  ) VALUES (
    ${sql(candidate.id)},
    ${sql(linkedServer.id)},
    ${sql(serviceId)},
    ${sql(candidate.parsed.playerId)},
    ${sql(candidate.parsed.playerName)},
    ${sql(candidate.build.eventType)},
    ${sql(candidate.build.buildPart)},
    ${sql(candidate.build.targetObject)},
    ${sql(candidate.build.tool)},
    ${sql(candidate.build.placedObject)},
    ${sql(candidate.build.placedClass)},
    ${sql(position?.x ?? null)},
    ${sql(position?.y ?? null)},
    ${sql(position?.z ?? null)},
    ${sql(admFile)},
    ${sql(candidate.lineNumber)},
    ${sql(candidate.parsed.occurredAt ?? new Date().toISOString())},
    ${sql(candidate.parsed.rawLine)},
    CURRENT_TIMESTAMP
  );`;
}

function buildRebuildSql(linkedServerId: string, nitradoServiceId: string) {
  return `INSERT INTO server_build_stats (
    linked_server_id, nitrado_service_id, structures_built, build_items_placed,
    storage_items_placed, traps_placed, build_score, top_builder_name,
    top_builder_count, last_build_at, updated_at
  )
  SELECT
    ${sql(linkedServerId)},
    ${sql(nitradoServiceId)},
    COALESCE(SUM(CASE WHEN event_type = 'built' AND build_part IN ('base','wall_base_up','wall_base_down','wall_wood_up','wall_wood_down','wall_metal_up','wall_metal_down','wall_gate','platform','stairs','roof','floor','ramp','watchtower','watchtower_base','watchtower_floor','watchtower_roof','watchtower_stairs','watchtower_wall') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN ('fencekit','watchtowerkit','territoryflagkit','flagpolekit','shelterkit') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'placed' AND (lower(COALESCE(placed_class, '')) LIKE 'woodencrate%' OR lower(COALESCE(placed_class, '')) LIKE 'barrel%' OR lower(COALESCE(placed_class, '')) LIKE 'seachest%' OR lower(COALESCE(placed_class, '')) LIKE 'tent%' OR lower(COALESCE(placed_class, '')) LIKE 'mediumtent%' OR lower(COALESCE(placed_class, '')) LIKE 'largetent%' OR lower(COALESCE(placed_class, '')) LIKE 'cartent%') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN ('landminetrap','beartrap') THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE
      WHEN event_type = 'built' AND build_part = 'wall_gate' THEN 15
      WHEN event_type = 'built' AND build_part = 'base' THEN 12
      WHEN event_type = 'built' AND build_part LIKE 'wall_metal_%' THEN 12
      WHEN event_type = 'built' AND build_part IN ('base','wall_base_up','wall_base_down','wall_wood_up','wall_wood_down','wall_metal_up','wall_metal_down','wall_gate','platform','stairs','roof','floor','ramp','watchtower','watchtower_base','watchtower_floor','watchtower_roof','watchtower_stairs','watchtower_wall') THEN 10
      WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN ('fencekit','watchtowerkit','territoryflagkit','flagpolekit','shelterkit') THEN 5
      WHEN event_type = 'placed' AND (lower(COALESCE(placed_class, '')) LIKE 'woodencrate%' OR lower(COALESCE(placed_class, '')) LIKE 'barrel%' OR lower(COALESCE(placed_class, '')) LIKE 'seachest%' OR lower(COALESCE(placed_class, '')) LIKE 'tent%' OR lower(COALESCE(placed_class, '')) LIKE 'mediumtent%' OR lower(COALESCE(placed_class, '')) LIKE 'largetent%' OR lower(COALESCE(placed_class, '')) LIKE 'cartent%') THEN 3
      WHEN event_type = 'placed' AND lower(COALESCE(placed_class, '')) IN ('landminetrap','beartrap') THEN 1
      ELSE 0
    END), 0),
    (SELECT player_name FROM build_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type IN ('built','placed') AND player_name IS NOT NULL GROUP BY COALESCE(player_id, lower(player_name)), player_name ORDER BY COUNT(*) DESC, MAX(COALESCE(occurred_at, created_at)) DESC LIMIT 1),
    COALESCE((SELECT COUNT(*) FROM build_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type IN ('built','placed') AND player_name IS NOT NULL GROUP BY COALESCE(player_id, lower(player_name)), player_name ORDER BY COUNT(*) DESC, MAX(COALESCE(occurred_at, created_at)) DESC LIMIT 1), 0),
    MAX(COALESCE(occurred_at, created_at)),
    CURRENT_TIMESTAMP
  FROM build_events
  WHERE linked_server_id = ${sql(linkedServerId)}
  ON CONFLICT(linked_server_id) DO UPDATE SET
    nitrado_service_id = excluded.nitrado_service_id,
    structures_built = excluded.structures_built,
    build_items_placed = excluded.build_items_placed,
    storage_items_placed = excluded.storage_items_placed,
    traps_placed = excluded.traps_placed,
    build_score = excluded.build_score,
    top_builder_name = excluded.top_builder_name,
    top_builder_count = excluded.top_builder_count,
    last_build_at = excluded.last_build_at,
    updated_at = CURRENT_TIMESTAMP;`;
}

function printPlan(values: {
  mode: Mode;
  serviceId: string;
  linkedServerId: string;
  admFile: string;
  source: string;
  linesScanned: number;
  placedEventsFound: number;
  builtEventsFound: number;
  eventsFound: number;
  missingEvents: number;
  structuresBuilt: number;
  buildItemsPlaced: number;
  storageItemsPlaced: number;
  trapsPlaced: number;
  buildScore: number;
}) {
  console.log(values.mode === "dry-run" ? "DZN build event backfill dry run." : "DZN build event backfill apply plan.");
  console.log("");
  console.log(`Service ID: ${values.serviceId}`);
  console.log(`Linked server ID: ${values.linkedServerId}`);
  console.log(`ADM file: ${values.admFile}`);
  console.log(`Source: ${values.source}`);
  console.log(`Lines scanned: ${values.linesScanned}`);
  console.log(`Placed events found: ${values.placedEventsFound}`);
  console.log(`Built events found: ${values.builtEventsFound}`);
  console.log(`Build events found: ${values.eventsFound}`);
  console.log(`Missing build events to add: ${values.missingEvents}`);
  console.log(`Structures built: ${values.structuresBuilt}`);
  console.log(`Build kits placed: ${values.buildItemsPlaced}`);
  console.log(`Storage placed: ${values.storageItemsPlaced}`);
  console.log(`Traps placed: ${values.trapsPlaced}`);
  console.log(`Expected build score: ${values.buildScore}`);
  if (values.mode === "dry-run") console.log("No database changes made.");
}

async function findLinkedServer(requestedServiceId: string): Promise<LinkedServerRow> {
  const rows = await d1Query<LinkedServerRow>(
    `SELECT id, user_id, CAST(nitrado_service_id AS TEXT) AS nitrado_service_id
     FROM linked_servers
     WHERE CAST(nitrado_service_id AS TEXT) = ${sql(requestedServiceId)}
     LIMIT 1`,
  );
  const linkedServer = rows[0];
  if (!linkedServer?.id || !linkedServer.user_id) fail(`No linked server found for service id ${requestedServiceId}.`);
  return linkedServer;
}

async function getExistingBuildRows(requestedServiceId: string, admFile: string) {
  return d1Query<ExistingBuildRow>(
    `SELECT nitrado_service_id, source_adm_file, source_line_number
     FROM build_events
     WHERE CAST(nitrado_service_id AS TEXT) = ${sql(requestedServiceId)}
       AND source_adm_file = ${sql(admFile)}`,
  ).catch(() => []);
}

async function loadNitradoToken(linkedServer: LinkedServerRow): Promise<{ token: string; source: TokenSource }> {
  const directToken = process.env.NITRADO_TOKEN?.trim();
  if (directToken) return { token: directToken, source: "environment/direct" };

  const tokenEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (tokenEncryptionKey) {
    const tokenRow = await getTokenRow(linkedServer).catch(() => null);
    if (tokenRow) {
      try {
        return {
          token: await decryptToken(tokenRow.encrypted_token, tokenRow.token_iv, tokenRow.token_auth_tag, tokenEncryptionKey),
          source: "stored",
        };
      } catch {
        // Fall through to local file.
      }
    }
  }

  if (existsSync(LOCAL_TOKEN_FILE)) {
    const token = readFileSync(LOCAL_TOKEN_FILE, "utf8").trim();
    if (token) return { token, source: "local file" };
  }

  fail("No Nitrado token source found. Set NITRADO_TOKEN or use --adm-local for a local ADM file.");
}

async function getTokenRow(linkedServer: LinkedServerRow): Promise<TokenRow> {
  const rows = await d1Query<TokenRow>(
    `SELECT encrypted_token, token_iv, token_auth_tag
     FROM nitrado_connections
     WHERE linked_server_id = ${sql(linkedServer.id)} AND user_id = ${sql(linkedServer.user_id)}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.encrypted_token || !row.token_iv || !row.token_auth_tag) fail("No encrypted Nitrado token found for this linked server.");
  return row;
}

function buildDedupeKey(row: ExistingBuildRow) {
  return `${row.nitrado_service_id}:${row.source_adm_file}:${row.source_line_number}`;
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

function resolveMode(parsedArgs: Map<string, string | true>): Mode {
  const dryRun = parsedArgs.has("dry-run");
  const apply = parsedArgs.has("apply");
  if (dryRun === apply) fail("Choose exactly one mode: --dry-run or --apply.");
  return apply ? "apply" : "dry-run";
}

function stringArg(parsedArgs: Map<string, string | true>, key: string) {
  const value = parsedArgs.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--yes", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) fail(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

async function d1ExecuteFile(sqlCommand: string) {
  const dir = mkdtempSync(join(tmpdir(), "dzn-build-backfill-"));
  const file = join(dir, "backfill-build-events.sql");
  try {
    writeFileSync(file, ensureSqlFileTerminates(sqlCommand), "utf8");
    runWrangler(["d1", "execute", DATABASE_NAME, "--remote", `--file=${file}`]);
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.error("D1 apply failed. SQL file kept for debugging:");
    console.error(file);
    throw error;
  }
}

function runWrangler(args: string[]) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  } satisfies ExecFileSyncOptionsWithStringEncoding);
}

function parseWranglerJson(output: string): Array<{ success: boolean; results?: unknown[] }> {
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) fail("Wrangler did not return JSON output.");
  return JSON.parse(output.slice(jsonStart));
}

function ensureSqlFileTerminates(sqlCommand: string) {
  const trimmed = sqlCommand.trim();
  return trimmed.endsWith(";") ? `${trimmed}\n` : `${trimmed};\n`;
}

async function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number) {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hash = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hash.slice(0, 48)}`;
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

function extractAdmDate(fileName: string | null) {
  return fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null : null;
}

function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function loadEnvFiles() {
  for (const file of [".env.local", ".env", ".dev.vars"]) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
