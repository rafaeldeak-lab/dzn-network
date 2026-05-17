import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parseAdmLines, type ParsedAdmEvent } from "../functions/_lib/adm-parser";

const DATABASE_NAME = "dzn_network_db";

type Mode = "dry-run" | "apply";
type ApplyPhase = "INSERTS" | "REBUILD" | "CURSOR";

type LinkedServerRow = {
  id: string;
  user_id: string;
  nitrado_service_id?: string | number | null;
  service_id?: string | number | null;
  display_name?: string | null;
  server_name?: string | null;
  hostname?: string | null;
  nitrado_service_name?: string | null;
};

type KillRow = {
  id: string;
  source_service_id: string | null;
  source_adm_file: string | null;
  source_line_number: number | null;
  adm_file: string | null;
  line_number: number | null;
  killer_id: string | null;
  killer_name: string | null;
  victim_id: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
};

type ProfileRow = {
  id: string;
  player_name: string;
  player_id: string | null;
};

type ServerStatsRow = {
  total_kills: number | null;
};

type KillCandidate = {
  parsed: ParsedAdmEvent;
  lineNumber: number;
  primaryId: string;
  primaryKey: string;
  fallbackKey: string;
};

const args = parseArgs(process.argv.slice(2));
const mode = args.has("apply") ? "apply" : "dry-run";
const serviceId = stringArg(args, "service-id");
const admLocal = stringArg(args, "adm-local");

if (!serviceId) fail("Missing --service-id. Example: npm run diagnose:adm-import -- --service-id 18765761 --adm-local \"C:\\\\path\\\\to\\\\file.ADM\"");
if (!admLocal) fail("Missing --adm-local. Point this at the downloaded ADM file.");

main().catch((error) => {
  console.error("ADM import diagnostic failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const admPath = resolve(admLocal!);
  if (!existsSync(admPath)) fail(`ADM file does not exist: ${admPath}`);

  const linkedServer = await findLinkedServer(serviceId!);
  const serverName = firstString(linkedServer.display_name, linkedServer.hostname, linkedServer.server_name, linkedServer.nitrado_service_name) ?? linkedServer.id;
  const admFile = basename(admPath);
  const rawLines = readFileSync(admPath, "utf8").split(/\r?\n/);
  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  const killedByPlayerLineNumbers = lines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter((entry) => /\bkilled by\s+Player\s+"/i.test(entry.line));
  const parsed = parseAdmLines(lines, { admDate: extractAdmDate(admFile) ?? undefined });
  const killCandidates = buildKillCandidates(parsed, linkedServer.id, String(linkedServer.nitrado_service_id ?? linkedServer.service_id ?? serviceId), admFile);
  const parsedKillLineNumbers = new Set(killCandidates.map((candidate) => candidate.lineNumber));
  const skippedKillLines = killedByPlayerLineNumbers.filter((entry) => !parsedKillLineNumbers.has(entry.lineNumber));
  const existingKills = await getExistingKills(linkedServer.id);
  const existingPrimaryKeys = new Set(existingKills.map((row) => existingPrimaryKey(row)).filter(Boolean));
  const existingFallbackKeys = new Set(existingKills.map(killFallbackKey));
  const missingKills = killCandidates.filter(
    (candidate) => !existingPrimaryKeys.has(candidate.primaryKey) && !existingFallbackKeys.has(candidate.fallbackKey),
  );
  const existingSkipped = killCandidates.length - missingKills.length;
  const profiles = await getProfiles(linkedServer.id);
  const profilePlan = buildProfilePlan(profiles, missingKills);
  const stats = await getServerStats(linkedServer.id);
  const expectedTotalKills = existingKills.length + missingKills.length;

  printPlan({
    mode,
    serviceId: serviceId!,
    linkedServerId: linkedServer.id,
    serverName,
    admFile,
    linesScanned: lines.length,
    killedByPlayerLinesFound: killedByPlayerLineNumbers.length,
    parserMatchedKills: killCandidates.length,
    parserSkippedKills: skippedKillLines.length,
    skippedKillLineNumbers: skippedKillLines.map((entry) => entry.lineNumber),
    existingKillsSkipped: existingSkipped,
    missingKillsToInsert: missingKills.length,
    currentServerTotalKills: Number(stats?.total_kills ?? existingKills.length),
    expectedTotalKills,
  });
  console.log("DZN ADM KILL IMPORT DIAGNOSTICS READY");

  if (mode === "dry-run") return;

  await applyImport({
    linkedServer,
    serviceId: serviceId!,
    admFile,
    admPath,
    linesScanned: lines.length,
    missingKills,
    profilePlan,
  });

  console.log("");
  console.log(`Applied missing kill_events: ${missingKills.length}`);
  console.log(`Cursor updated to: ${admFile} line ${lines.length}`);
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

function stringArg(values: Map<string, string | true>, key: string) {
  const value = values.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function findLinkedServer(serviceIdValue: string): Promise<LinkedServerRow> {
  const columns = await getColumns("linked_servers");
  const serviceColumns = ["nitrado_service_id", "service_id"].filter((column) => columns.has(column));
  if (!serviceColumns.length) fail("linked_servers does not contain nitrado_service_id or service_id.");
  const where = serviceColumns.map((column) => `CAST(${column} AS TEXT) = ${sql(serviceIdValue)}`).join(" OR ");
  const rows = await d1Query<LinkedServerRow>(
    `SELECT *
     FROM linked_servers
     WHERE ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row?.id) fail(`No linked server found for service id ${serviceIdValue}.`);
  return row;
}

async function getColumns(table: string) {
  const rows = await d1Query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

function buildKillCandidates(parsed: ParsedAdmEvent[], linkedServerId: string, sourceServiceId: string, admFile: string): KillCandidate[] {
  const candidates: KillCandidate[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const event = parsed[index];
    if (!isCreditedKill(event)) continue;
    const lineNumber = index + 1;
    candidates.push({
      parsed: event,
      lineNumber,
      primaryId: stableSyncId("kill-event", linkedServerId, admFile, lineNumber),
      primaryKey: primaryKey(sourceServiceId, admFile, lineNumber),
      fallbackKey: parsedFallbackKey(sourceServiceId, event),
    });
  }
  return candidates;
}

function isCreditedKill(event: ParsedAdmEvent) {
  return event.eventType === "player_killed" && event.isCreditedKill && /\bkilled by\s+Player\s+"/i.test(event.rawLine);
}

async function getExistingKills(linkedServerId: string) {
  return d1Query<KillRow>(
    `SELECT id, source_service_id, source_adm_file, source_line_number, adm_file, line_number,
            killer_id, killer_name, victim_id, victim_name, weapon, distance, occurred_at
     FROM kill_events
     WHERE linked_server_id = ${sql(linkedServerId)}`,
  );
}

async function getProfiles(linkedServerId: string) {
  return d1Query<ProfileRow>(
    `SELECT id, player_name, player_id
     FROM player_profiles
     WHERE linked_server_id = ${sql(linkedServerId)}`,
  );
}

async function getServerStats(linkedServerId: string) {
  const rows = await d1Query<ServerStatsRow>(
    `SELECT total_kills
     FROM server_stats
     WHERE linked_server_id = ${sql(linkedServerId)}
     LIMIT 1`,
  );
  return rows[0] ?? null;
}

function buildProfilePlan(existingProfiles: ProfileRow[], missingKills: KillCandidate[]) {
  const byId = new Map<string, ProfileRow>();
  const byName = new Map<string, ProfileRow>();
  for (const profile of existingProfiles) {
    if (profile.player_id) byId.set(profile.player_id, profile);
    byName.set(profile.player_name.toLowerCase(), profile);
  }

  const inserts = new Map<string, ProfileRow>();
  const touchedProfileIds = new Set<string>();
  const profileIdsByKill = new Map<KillCandidate, { killerProfileId: string | null; victimProfileId: string | null }>();

  function resolvePlayer(name: string | null | undefined, playerId: string | null | undefined) {
    if (!name) return null;
    const existing = playerId ? byId.get(playerId) : byName.get(name.toLowerCase());
    if (existing) {
      touchedProfileIds.add(existing.id);
      return existing.id;
    }
    const key = playerId ? `id:${playerId}` : `name:${name.toLowerCase()}`;
    const planned = inserts.get(key);
    if (planned) {
      touchedProfileIds.add(planned.id);
      return planned.id;
    }
    const profile = {
      id: randomUUID(),
      player_name: name,
      player_id: playerId ?? null,
    };
    inserts.set(key, profile);
    if (profile.player_id) byId.set(profile.player_id, profile);
    byName.set(profile.player_name.toLowerCase(), profile);
    touchedProfileIds.add(profile.id);
    return profile.id;
  }

  for (const candidate of missingKills) {
    profileIdsByKill.set(candidate, {
      killerProfileId: resolvePlayer(candidate.parsed.killerName ?? candidate.parsed.playerName, candidate.parsed.killerId ?? candidate.parsed.playerId),
      victimProfileId: resolvePlayer(candidate.parsed.victimName, candidate.parsed.victimId),
    });
  }

  return { inserts: [...inserts.values()], touchedProfileIds, profileIdsByKill };
}

async function applyImport(values: {
  linkedServer: LinkedServerRow;
  serviceId: string;
  admFile: string;
  admPath: string;
  linesScanned: number;
  missingKills: KillCandidate[];
  profilePlan: ReturnType<typeof buildProfilePlan>;
}) {
  const inserts: string[] = [];
  for (const profile of values.profilePlan.inserts) {
    inserts.push(
      `INSERT OR IGNORE INTO player_profiles (
        id, linked_server_id, source_service_id, player_name, player_id, first_seen_at, created_at, updated_at
      ) VALUES (
        ${sql(profile.id)}, ${sql(values.linkedServer.id)}, ${sql(values.serviceId)}, ${sql(profile.player_name)}, ${sql(profile.player_id)},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );`,
    );
  }

  for (const candidate of values.missingKills) {
    const profiles = values.profilePlan.profileIdsByKill.get(candidate);
    const rawId = stableSyncId("raw", values.linkedServer.id, values.admFile, candidate.lineNumber);
    inserts.push(
      `INSERT OR IGNORE INTO adm_raw_events (
        id, linked_server_id, source_service_id, source_sync_run_id, adm_file, source_adm_file,
        line_number, source_line_number, raw_line, event_type, parsed, created_at
      ) VALUES (
        ${sql(rawId)}, ${sql(values.linkedServer.id)}, ${sql(values.serviceId)}, NULL, ${sql(values.admFile)}, ${sql(values.admFile)},
        ${candidate.lineNumber}, ${candidate.lineNumber}, ${sql(candidate.parsed.rawLine)}, ${sql(candidate.parsed.eventType)}, 1, CURRENT_TIMESTAMP
      );`,
    );
    inserts.push(
      `INSERT OR IGNORE INTO kill_events (
        id, linked_server_id, source_service_id, source_sync_run_id, killer_profile_id,
        victim_profile_id, killer_name, victim_name, killer_id, victim_id, weapon,
        distance, position_x, position_y, position_z, adm_file, source_adm_file,
        line_number, source_line_number, occurred_at, raw_line, created_at
      ) VALUES (
        ${sql(candidate.primaryId)}, ${sql(values.linkedServer.id)}, ${sql(values.serviceId)}, NULL,
        ${sql(profiles?.killerProfileId ?? null)}, ${sql(profiles?.victimProfileId ?? null)},
        ${sql(candidate.parsed.killerName ?? candidate.parsed.playerName)}, ${sql(candidate.parsed.victimName)},
        ${sql(candidate.parsed.killerId ?? candidate.parsed.playerId)}, ${sql(candidate.parsed.victimId)},
        ${sql(candidate.parsed.weapon)}, ${sql(candidate.parsed.distance)},
        ${sql(candidate.parsed.killerPosition?.x ?? candidate.parsed.position?.x ?? null)},
        ${sql(candidate.parsed.killerPosition?.y ?? candidate.parsed.position?.y ?? null)},
        ${sql(candidate.parsed.killerPosition?.z ?? candidate.parsed.position?.z ?? null)},
        ${sql(values.admFile)}, ${sql(values.admFile)}, ${candidate.lineNumber}, ${candidate.lineNumber},
        ${sql(candidate.parsed.occurredAt)}, ${sql(candidate.parsed.rawLine)}, CURRENT_TIMESTAMP
      );`,
    );
  }

  await d1ExecuteFile(inserts.join("\n"), "INSERTS");
  await d1ExecuteFile(
    [
      linkExistingKillProfilesSql(values.linkedServer.id),
      rebuildPlayerProfilesSql(values.linkedServer.id),
      rebuildServerStatsSql(values.linkedServer.id, values.serviceId),
    ].join("\n"),
    "REBUILD",
  );
  await d1ExecuteFile(
    upsertSyncCursorSql(values.linkedServer.id, values.serviceId, values.admFile, values.admPath, values.linesScanned, values.missingKills.length),
    "CURSOR",
  );
}

function linkExistingKillProfilesSql(linkedServerId: string) {
  return `UPDATE kill_events
    SET
      killer_profile_id = COALESCE(
        killer_profile_id,
        (
          SELECT id FROM player_profiles
          WHERE player_profiles.linked_server_id = ${sql(linkedServerId)}
            AND (
              (kill_events.killer_id IS NOT NULL AND player_profiles.player_id = kill_events.killer_id)
              OR lower(player_profiles.player_name) = lower(kill_events.killer_name)
            )
          LIMIT 1
        )
      ),
      victim_profile_id = COALESCE(
        victim_profile_id,
        (
          SELECT id FROM player_profiles
          WHERE player_profiles.linked_server_id = ${sql(linkedServerId)}
            AND (
              (kill_events.victim_id IS NOT NULL AND player_profiles.player_id = kill_events.victim_id)
              OR lower(player_profiles.player_name) = lower(kill_events.victim_name)
            )
          LIMIT 1
        )
      )
    WHERE linked_server_id = ${sql(linkedServerId)};`;
}

function rebuildPlayerProfilesSql(linkedServerId: string) {
  return `UPDATE player_profiles
    SET
      kills = (
        SELECT COUNT(*) FROM kill_events
        WHERE kill_events.linked_server_id = ${sql(linkedServerId)}
          AND kill_events.killer_profile_id = player_profiles.id
      ),
      deaths = (
        SELECT COUNT(*) FROM kill_events
        WHERE kill_events.linked_server_id = ${sql(linkedServerId)}
          AND kill_events.victim_profile_id = player_profiles.id
      ) + (
        SELECT COUNT(*) FROM player_events
        WHERE player_events.linked_server_id = ${sql(linkedServerId)}
          AND player_events.player_profile_id = player_profiles.id
          AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
      ),
      suicides = (
        SELECT COUNT(*) FROM player_events
        WHERE player_events.linked_server_id = ${sql(linkedServerId)}
          AND player_events.player_profile_id = player_profiles.id
          AND player_events.event_type = 'player_suicide'
      ),
      longest_kill_distance = COALESCE((
        SELECT MAX(distance) FROM kill_events
        WHERE kill_events.linked_server_id = ${sql(linkedServerId)}
          AND kill_events.killer_profile_id = player_profiles.id
      ), 0),
      updated_at = CURRENT_TIMESTAMP
    WHERE linked_server_id = ${sql(linkedServerId)};`;
}

function rebuildServerStatsSql(linkedServerId: string, serviceIdValue: string) {
  return `INSERT INTO server_stats (
      id, linked_server_id, source_service_id, total_kills, total_deaths, total_joins, total_disconnects,
      unique_players, last_event_at, updated_at
    ) VALUES (
      ${sql(randomUUID())},
      ${sql(linkedServerId)},
      ${sql(serviceIdValue)},
      (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)}),
      (
        SELECT COUNT(*) FROM kill_events
        WHERE linked_server_id = ${sql(linkedServerId)} AND victim_name IS NOT NULL
      ) + (
        SELECT COUNT(*) FROM player_events
        WHERE linked_server_id = ${sql(linkedServerId)}
          AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
      ),
      (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type = 'player_connected'),
      (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ${sql(linkedServerId)} AND event_type = 'player_disconnected'),
      (SELECT COUNT(*) FROM player_profiles WHERE linked_server_id = ${sql(linkedServerId)}),
      (
        SELECT MAX(COALESCE(occurred_at, created_at))
        FROM (
          SELECT occurred_at, created_at FROM player_events WHERE linked_server_id = ${sql(linkedServerId)}
          UNION ALL
          SELECT occurred_at, created_at FROM kill_events WHERE linked_server_id = ${sql(linkedServerId)}
        )
      ),
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(linked_server_id) DO UPDATE SET
      source_service_id = COALESCE(excluded.source_service_id, server_stats.source_service_id),
      total_kills = excluded.total_kills,
      total_deaths = excluded.total_deaths,
      total_joins = excluded.total_joins,
      total_disconnects = excluded.total_disconnects,
      unique_players = excluded.unique_players,
      last_event_at = excluded.last_event_at,
      updated_at = CURRENT_TIMESTAMP;`;
}

function upsertSyncCursorSql(linkedServerId: string, serviceIdValue: string, admFile: string, admPath: string, linesScanned: number, killsAdded: number) {
  return `INSERT INTO adm_sync_state (
      id, linked_server_id, source_service_id, latest_adm_file, latest_adm_path, last_processed_file,
      last_processed_line, last_processed_offset, last_sync_status, last_sync_message,
      last_sync_at, last_lines_read, last_lines_processed, last_kills_created, updated_at
    ) VALUES (
      ${sql(randomUUID())}, ${sql(linkedServerId)}, ${sql(serviceIdValue)}, ${sql(admFile)}, ${sql(admPath)}, ${sql(admFile)},
      ${linesScanned}, 0, 'completed', ${sql(`Local ADM import inserted ${killsAdded} missing kill_events`)},
      CURRENT_TIMESTAMP, ${linesScanned}, ${linesScanned}, ${killsAdded}, CURRENT_TIMESTAMP
    )
    ON CONFLICT(linked_server_id) DO UPDATE SET
      source_service_id = COALESCE(excluded.source_service_id, adm_sync_state.source_service_id),
      latest_adm_file = excluded.latest_adm_file,
      latest_adm_path = excluded.latest_adm_path,
      last_processed_file = excluded.last_processed_file,
      last_processed_line = excluded.last_processed_line,
      last_sync_status = excluded.last_sync_status,
      last_sync_message = excluded.last_sync_message,
      last_sync_at = CURRENT_TIMESTAMP,
      last_lines_read = excluded.last_lines_read,
      last_lines_processed = excluded.last_lines_processed,
      last_kills_created = excluded.last_kills_created,
      updated_at = CURRENT_TIMESTAMP;`;
}

async function d1Query<T>(sqlCommand: string): Promise<T[]> {
  const output = runWrangler(["d1", "execute", DATABASE_NAME, "--remote", "--json", "--yes", "--command", sqlCommand]);
  const payload = parseWranglerJson(output);
  const first = payload[0];
  if (!first?.success) fail(`D1 query failed: ${sqlCommand}`);
  return (first.results ?? []) as T[];
}

async function d1ExecuteFile(sqlCommand: string, phase: ApplyPhase) {
  if (!sqlCommand.trim()) return;

  const dir = mkdtempSync(join(tmpdir(), "dzn-adm-diagnose-"));
  const file = join(dir, "diagnose.sql");
  try {
    writeFileSync(file, ensureSqlFileTerminates(sqlCommand), "utf8");
    const output = runWranglerFileApply(file);
    if (/error|failed/i.test(output) && !/success/i.test(output)) throw new Error(output);
  } catch (error) {
    printD1ApplyFailure(error, file, phase);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runWrangler(argsValue: string[]) {
  return runWranglerNode(argsValue, {
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

function runWranglerNode(argsValue: string[], options: ExecFileSyncOptionsWithStringEncoding) {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(wranglerBin)) fail("Wrangler is not installed locally. Run npm install, then try again.");
  return execFileSync(process.execPath, [wranglerBin, ...argsValue], {
    ...options,
    encoding: "utf8",
  });
}

function parseWranglerJson(output: string): Array<{ success: boolean; results?: unknown[] }> {
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) fail("Wrangler did not return JSON output.");
  return JSON.parse(output.slice(jsonStart));
}

function printPlan(values: {
  mode: Mode;
  serviceId: string;
  linkedServerId: string;
  serverName: string;
  admFile: string;
  linesScanned: number;
  killedByPlayerLinesFound: number;
  parserMatchedKills: number;
  parserSkippedKills: number;
  skippedKillLineNumbers: number[];
  existingKillsSkipped: number;
  missingKillsToInsert: number;
  currentServerTotalKills: number;
  expectedTotalKills: number;
}) {
  console.log(values.mode === "apply" ? "DZN ADM import diagnostic apply plan." : "DZN ADM import diagnostic dry run.");
  console.log("");
  console.log(`Service ID: ${values.serviceId}`);
  console.log(`Linked server ID: ${values.linkedServerId}`);
  console.log(`Server name: ${values.serverName}`);
  console.log(`ADM file: ${values.admFile}`);
  console.log(`Lines scanned: ${values.linesScanned}`);
  console.log(`killed by Player lines found: ${values.killedByPlayerLinesFound}`);
  console.log(`Parser matched kill lines: ${values.parserMatchedKills}`);
  console.log(`Parser skipped kill lines: ${values.parserSkippedKills}`);
  if (values.skippedKillLineNumbers.length) {
    console.log(`Parser skipped line numbers: ${values.skippedKillLineNumbers.slice(0, 20).join(", ")}${values.skippedKillLineNumbers.length > 20 ? " ..." : ""}`);
    console.log("Skipped reason: unsupported kill format or missing player block.");
  }
  console.log(`Existing kill_events skipped: ${values.existingKillsSkipped}`);
  console.log(`Missing kill_events to insert: ${values.missingKillsToInsert}`);
  console.log(`Current server total kills: ${values.currentServerTotalKills}`);
  console.log(`Expected kills after import: ${values.expectedTotalKills}`);
  if (values.mode === "dry-run") console.log("No database changes made. Re-run with --apply to insert missing rows.");
}

function primaryKey(sourceServiceId: string | null | undefined, admFile: string | null | undefined, lineNumber: number | null | undefined) {
  return `${sourceServiceId ?? ""}|${admFile ?? ""}|${lineNumber ?? ""}`.toLowerCase();
}

function existingPrimaryKey(row: KillRow) {
  return primaryKey(row.source_service_id, row.source_adm_file ?? row.adm_file, row.source_line_number ?? row.line_number);
}

function parsedFallbackKey(sourceServiceId: string, event: ParsedAdmEvent) {
  return [
    sourceServiceId,
    event.occurredAt ?? "",
    event.killerId ?? event.killerName ?? event.playerId ?? event.playerName ?? "",
    event.victimId ?? event.victimName ?? "",
    event.weapon ?? "",
    normalizeDistance(event.distance),
  ].join("|").toLowerCase();
}

function killFallbackKey(row: KillRow) {
  return [
    row.source_service_id ?? "",
    row.occurred_at ?? "",
    row.killer_id ?? row.killer_name ?? "",
    row.victim_id ?? row.victim_name ?? "",
    row.weapon ?? "",
    normalizeDistance(row.distance),
  ].join("|").toLowerCase();
}

function normalizeDistance(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : "";
}

function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  return `${prefix}:${createHash("sha256").update(input).digest("hex").slice(0, 48)}`;
}

function extractAdmDate(fileName: string | null) {
  return fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1] ?? null : null;
}

function sql(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function ensureSqlFileTerminates(sqlCommand: string) {
  const trimmed = sqlCommand.trim();
  return trimmed.endsWith(";") ? `${trimmed}\n` : `${trimmed};\n`;
}

function printD1ApplyFailure(error: unknown, sqlFilePath: string, phase: ApplyPhase): never {
  const commandError = error as { stdout?: unknown; stderr?: unknown; message?: string };
  console.error(`D1 apply failed during phase: ${phase}`);
  console.error("Wrangler stdout:");
  console.error(normalizeCommandOutput(commandError.stdout) || "(empty)");
  console.error("Wrangler stderr:");
  console.error(normalizeCommandOutput(commandError.stderr) || commandError.message || "(empty)");
  console.error(`SQL file kept for debugging:\n${sqlFilePath}`);
  process.exit(1);
}

function normalizeCommandOutput(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value instanceof Buffer) return value.toString("utf8").trim();
  return "";
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
