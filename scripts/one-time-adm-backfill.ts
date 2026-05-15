/**
 * ONE-TIME LOCAL ADM BACKFILL SCRIPT
 *
 * This script is not part of normal DZN sync.
 * It only runs when manually executed from the terminal.
 * It safely inserts missing historical ADM kills, rebuilds totals,
 * updates the sync cursor, then exits.
 *
 * Normal scheduled/manual ADM sync continues as usual afterwards.
 */

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseAdmLines, type ParsedAdmEvent } from "../functions/_lib/adm-parser";
import { decryptToken } from "../functions/_lib/crypto";
import { fetchReadableNitradoAdmLines, type NitradoLogAccessDiagnostics } from "../functions/_lib/nitrado";

const DATABASE_NAME = "dzn_network_db";
const DEFAULT_ADM_FILE = "DayZServer_PS4_x64_2026-05-15_19-42-40.ADM";
const LOCAL_TOKEN_FILE = ".local-nitrado-token";

type Mode = "dry-run" | "apply";
type TokenSource = "environment/direct" | "stored" | "local file";
type ApplyPhase = "INSERTS" | "REBUILD" | "CURSOR";

type LinkedServerRow = {
  id: string;
  user_id: string;
  nitrado_service_id?: string | number | null;
  service_id?: string | number | null;
};

type TokenRow = {
  encrypted_token: string;
  token_iv: string;
  token_auth_tag: string;
};

type KillRow = {
  id: string;
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
  fallbackKey: string;
};

loadEnvFiles();

const args = parseArgs(process.argv.slice(2));
const mode = resolveMode(args);
const requestedServiceId = stringArg(args, "service-id");
const preferredAdmFile = stringArg(args, "adm-file") ?? DEFAULT_ADM_FILE;

if (!requestedServiceId) fail("Missing --service-id. Example: npm run backfill:adm:once -- --service-id 18765761 --dry-run");
const serviceId = requestedServiceId;

main().catch((error) => {
  console.error("One-time ADM backfill failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const linkedServer = await findLinkedServer(serviceId);
  const tokenSource = await loadNitradoToken(linkedServer);

  const readable = await fetchReadableNitradoAdmLines(tokenSource.token, serviceId, {
    mode: "full",
    preferredAdmFileName: preferredAdmFile,
  }).catch((error) => {
    if (isNitradoTokenError(error)) fail("Nitrado token was rejected. Please check the token and try again.");
    throw error;
  });

  if (isNitradoTokenRejected(readable.diagnostics)) {
    fail("Nitrado token was rejected. Please check the token and try again.");
  }
  if (!readable.lines.length) {
    fail(readable.diagnostics.readable.message || "No readable ADM lines were returned by Nitrado.");
  }

  const admFile = readable.diagnostics.newestAdmFileName ?? preferredAdmFile;
  const admPath = readable.diagnostics.testedPathVariants?.[0] ?? admFile;
  const parsed = parseAdmLines(readable.lines, { admDate: extractAdmDate(admFile) ?? undefined });
  const killCandidates = await buildKillCandidates(parsed, linkedServer.id, admFile);
  const existingKills = await getExistingKills(linkedServer.id);
  const existingPrimaryIds = new Set(existingKills.map((row) => row.id));
  const existingFallbackKeys = new Set(existingKills.map(killFallbackKey));
  const missingKills = killCandidates.filter(
    (candidate) => !existingPrimaryIds.has(candidate.primaryId) && !existingFallbackKeys.has(candidate.fallbackKey),
  );
  const duplicateKillsSkipped = killCandidates.length - missingKills.length;
  const profiles = await getProfiles(linkedServer.id);
  const profilePlan = buildProfilePlan(profiles, killCandidates);
  const currentStats = await getServerStats(linkedServer.id);
  const currentKillEventCount = existingKills.length;
  const expectedKillTotal = currentKillEventCount + missingKills.length;

  printPlan({
    mode,
    serviceId,
    tokenSource: tokenSource.source,
    admFile,
    linesScanned: readable.lines.length,
    killLinesFound: killCandidates.length,
    existingKills: duplicateKillsSkipped,
    missingKills: missingKills.length,
    playersUpdated: profilePlan.touchedProfileIds.size,
    currentServerTotalKills: Number(currentStats?.total_kills ?? currentKillEventCount),
    expectedServerTotalKills: expectedKillTotal,
    selectedReadableRoute: readable.diagnostics.readable.routeRecommendation,
  });

  if (mode === "dry-run") return;

  await applyBackfill({
    linkedServer,
    serviceId,
    admFile,
    admPath,
    linesScanned: readable.lines.length,
    missingKills,
    profilePlan,
  });

  const finalKills = await getExistingKills(linkedServer.id);
  if (!missingKills.length) {
    console.log("");
    console.log("No missing kills found.");
    console.log("Database already up to date.");
    return;
  }

  console.log("");
  console.log("DZN ONE TIME ADM BACKFILL COMPLETE");
  console.log("");
  console.log(`Service ID: ${serviceId}`);
  console.log(`ADM file: ${admFile}`);
  console.log(`Lines scanned: ${readable.lines.length}`);
  console.log(`Kill lines found: ${killCandidates.length}`);
  console.log(`Existing kills skipped: ${duplicateKillsSkipped}`);
  console.log(`New kills added: ${missingKills.length}`);
  console.log(`Players updated: ${profilePlan.touchedProfileIds.size}`);
  console.log(`Server total kills: ${finalKills.length}`);
  console.log(`Cursor updated to line: ${readable.lines.length}`);
  console.log("Normal ADM auto-sync can now continue from the corrected cursor.");
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

function resolveMode(args: Map<string, string | true>): Mode {
  const dryRun = args.has("dry-run");
  const apply = args.has("apply");
  if (dryRun === apply) fail("Choose exactly one mode: --dry-run or --apply.");
  return apply ? "apply" : "dry-run";
}

function stringArg(args: Map<string, string | true>, key: string) {
  const value = args.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function findLinkedServer(serviceId: string): Promise<LinkedServerRow> {
  const columns = await getColumns("linked_servers");
  const serviceColumns = ["nitrado_service_id", "service_id"].filter((column) => columns.has(column));
  if (!serviceColumns.length) fail("linked_servers does not contain nitrado_service_id or service_id.");
  const where = serviceColumns.map((column) => `CAST(${column} AS TEXT) = ${sql(serviceId)}`).join(" OR ");
  const rows = await d1Query<LinkedServerRow>(`SELECT * FROM linked_servers WHERE ${where} LIMIT 1`);
  const linkedServer = rows[0];
  if (!linkedServer?.id || !linkedServer.user_id) fail(`No linked server found for service id ${serviceId}.`);
  return linkedServer;
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
        // Fall through to optional local token file, then the user-facing no-source message.
      }
    }
  }

  if (existsSync(LOCAL_TOKEN_FILE)) {
    const token = readFileSync(LOCAL_TOKEN_FILE, "utf8").trim();
    if (token) return { token, source: "local file" };
  }

  fail(`No Nitrado token source found.

Recommended one-time method:

PowerShell:
$env:NITRADO_TOKEN="YOUR_NITRADO_TOKEN"
npm run backfill:adm:once -- --service-id 18765761 --dry-run

Then, if the dry run looks correct:

npm run backfill:adm:once -- --service-id 18765761 --apply`);
}

async function buildKillCandidates(parsed: ParsedAdmEvent[], linkedServerId: string, admFile: string): Promise<KillCandidate[]> {
  const candidates: KillCandidate[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const event = parsed[index];
    if (!isCreditedKill(event)) continue;
    const lineNumber = index + 1;
    candidates.push({
      parsed: event,
      lineNumber,
      primaryId: await stableSyncId("kill-event", linkedServerId, admFile, lineNumber),
      fallbackKey: parsedFallbackKey(event),
    });
  }
  return candidates;
}

function isCreditedKill(event: ParsedAdmEvent) {
  return event.eventType === "player_killed" && event.isCreditedKill && /\bkilled by\s+Player\s+"/i.test(event.rawLine);
}

async function getExistingKills(linkedServerId: string) {
  return d1Query<KillRow>(
    `SELECT id, adm_file, line_number, killer_id, killer_name, victim_id, victim_name, weapon, distance, occurred_at
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
  const byPlayerId = new Map<string, ProfileRow>();
  const byPlayerName = new Map<string, ProfileRow>();
  for (const profile of existingProfiles) {
    if (profile.player_id) byPlayerId.set(profile.player_id, profile);
    byPlayerName.set(profile.player_name.toLowerCase(), profile);
  }

  const inserts = new Map<string, ProfileRow>();
  const touchedProfileIds = new Set<string>();

  function resolve(name: string | null, playerId: string | null) {
    if (!name) return null;
    const existing = playerId ? byPlayerId.get(playerId) : byPlayerName.get(name.toLowerCase());
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
      id: crypto.randomUUID(),
      player_name: name,
      player_id: playerId,
    };
    inserts.set(key, profile);
    if (playerId) byPlayerId.set(playerId, profile);
    byPlayerName.set(name.toLowerCase(), profile);
    touchedProfileIds.add(profile.id);
    return profile.id;
  }

  const profileIdsByKill = new Map<KillCandidate, { killerProfileId: string | null; victimProfileId: string | null }>();
  for (const candidate of missingKills) {
    profileIdsByKill.set(candidate, {
      killerProfileId: resolve(candidate.parsed.killerName ?? candidate.parsed.playerName, candidate.parsed.killerId ?? candidate.parsed.playerId),
      victimProfileId: resolve(candidate.parsed.victimName, candidate.parsed.victimId),
    });
  }

  return {
    inserts: [...inserts.values()],
    profileIdsByKill,
    touchedProfileIds,
  };
}

async function applyBackfill(values: {
  linkedServer: LinkedServerRow;
  serviceId: string;
  admFile: string;
  admPath: string;
  linesScanned: number;
  missingKills: KillCandidate[];
  profilePlan: ReturnType<typeof buildProfilePlan>;
}) {
  const insertStatements: string[] = [];
  for (const profile of values.profilePlan.inserts) {
    insertStatements.push(
      `INSERT OR IGNORE INTO player_profiles (
        id, linked_server_id, player_name, player_id, first_seen_at, created_at, updated_at
      ) VALUES (
        ${sql(profile.id)}, ${sql(values.linkedServer.id)}, ${sql(profile.player_name)}, ${sql(profile.player_id)},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );`,
    );
  }

  for (const candidate of values.missingKills) {
    const profileIds = values.profilePlan.profileIdsByKill.get(candidate);
    const rawId = await stableSyncId("raw", values.linkedServer.id, values.admFile, candidate.lineNumber);
    insertStatements.push(
      `INSERT OR IGNORE INTO adm_raw_events (
        id, linked_server_id, adm_file, line_number, raw_line, event_type, parsed, created_at
      ) VALUES (
        ${sql(rawId)}, ${sql(values.linkedServer.id)}, ${sql(values.admFile)}, ${candidate.lineNumber},
        ${sql(candidate.parsed.rawLine)}, ${sql(candidate.parsed.eventType)}, 1, CURRENT_TIMESTAMP
      );`,
    );
    insertStatements.push(
      `INSERT OR IGNORE INTO kill_events (
        id, linked_server_id, killer_profile_id, victim_profile_id, killer_name, victim_name,
        killer_id, victim_id, weapon, distance, position_x, position_y, position_z,
        adm_file, line_number, occurred_at, raw_line, created_at
      ) VALUES (
        ${sql(candidate.primaryId)}, ${sql(values.linkedServer.id)}, ${sql(profileIds?.killerProfileId ?? null)}, ${sql(profileIds?.victimProfileId ?? null)},
        ${sql(candidate.parsed.killerName ?? candidate.parsed.playerName)}, ${sql(candidate.parsed.victimName)},
        ${sql(candidate.parsed.killerId ?? candidate.parsed.playerId)}, ${sql(candidate.parsed.victimId)},
        ${sql(candidate.parsed.weapon)}, ${sql(candidate.parsed.distance)},
        ${sql(candidate.parsed.killerPosition?.x ?? candidate.parsed.position?.x ?? null)},
        ${sql(candidate.parsed.killerPosition?.y ?? candidate.parsed.position?.y ?? null)},
        ${sql(candidate.parsed.killerPosition?.z ?? candidate.parsed.position?.z ?? null)},
        ${sql(values.admFile)}, ${candidate.lineNumber}, ${sql(candidate.parsed.occurredAt)}, ${sql(candidate.parsed.rawLine)},
        CURRENT_TIMESTAMP
      );`,
    );
  }

  await d1ExecuteFile(insertStatements.join("\n"), "INSERTS");
  await d1ExecuteFile(
    [
      linkExistingKillProfilesSql(values.linkedServer.id),
      rebuildPlayerProfilesSql(values.linkedServer.id),
      rebuildServerStatsSql(values.linkedServer.id),
    ].join("\n"),
    "REBUILD",
  );
  await d1ExecuteFile(
    upsertSyncCursorSql(values.linkedServer.id, values.admFile, values.admPath, values.linesScanned, values.missingKills.length),
    "CURSOR",
  );
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

function rebuildServerStatsSql(linkedServerId: string) {
  return `INSERT INTO server_stats (
      id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects,
      unique_players, last_event_at, updated_at
    ) VALUES (
      ${sql(crypto.randomUUID())},
      ${sql(linkedServerId)},
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
      total_kills = excluded.total_kills,
      total_deaths = excluded.total_deaths,
      total_joins = excluded.total_joins,
      total_disconnects = excluded.total_disconnects,
      unique_players = excluded.unique_players,
      last_event_at = excluded.last_event_at,
      updated_at = CURRENT_TIMESTAMP;`;
}

function upsertSyncCursorSql(linkedServerId: string, admFile: string, admPath: string, linesScanned: number, killsAdded: number) {
  return `INSERT INTO adm_sync_state (
      id, linked_server_id, latest_adm_file, latest_adm_path, last_processed_file,
      last_processed_line, last_processed_offset, last_sync_status, last_sync_message,
      last_sync_at, last_lines_read, last_lines_processed, last_kills_created, updated_at
    ) VALUES (
      ${sql(crypto.randomUUID())}, ${sql(linkedServerId)}, ${sql(admFile)}, ${sql(admPath)}, ${sql(admFile)},
      ${linesScanned}, 0, 'completed', ${sql(`One-time ADM backfill inserted ${killsAdded} missing kills`)},
      CURRENT_TIMESTAMP, ${linesScanned}, ${linesScanned}, ${killsAdded}, CURRENT_TIMESTAMP
    )
    ON CONFLICT(linked_server_id) DO UPDATE SET
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

async function getColumns(table: string) {
  const rows = await d1Query<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
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

  const dir = mkdtempSync(join(tmpdir(), "dzn-adm-backfill-"));
  const file = join(dir, "backfill.sql");
  try {
    writeFileSync(file, ensureSqlFileTerminates(sqlCommand), "utf8");
    const output = runWranglerFileApply(file);
    if (/error|failed/i.test(output) && !/success/i.test(output)) {
      throw new Error(output);
    }
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
  const stdout = normalizeCommandOutput(commandError.stdout);
  const stderr = normalizeCommandOutput(commandError.stderr);
  console.error(`D1 apply failed during phase: ${phase}`);
  console.error("Wrangler stdout:");
  console.error(stdout || "(empty)");
  console.error("Wrangler stderr:");
  console.error(stderr || commandError.message || "(empty)");
  console.error(`Backfill SQL file kept for debugging:\n${sqlFilePath}`);
  process.exit(1);
}

function normalizeCommandOutput(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value instanceof Buffer) return value.toString("utf8").trim();
  return "";
}

function parseWranglerJson(output: string): Array<{ success: boolean; results?: unknown[] }> {
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) fail("Wrangler did not return JSON output.");
  return JSON.parse(output.slice(jsonStart));
}

function printPlan(values: {
  mode: Mode;
  serviceId: string;
  tokenSource: TokenSource;
  admFile: string;
  linesScanned: number;
  killLinesFound: number;
  existingKills: number;
  missingKills: number;
  playersUpdated: number;
  currentServerTotalKills: number;
  expectedServerTotalKills: number;
  selectedReadableRoute: string | null;
}) {
  console.log(values.mode === "dry-run" ? "DZN one-time ADM backfill dry run." : "DZN one-time ADM backfill apply plan.");
  console.log("");
  console.log(`Service ID: ${values.serviceId}`);
  console.log(`Token source: ${values.tokenSource}`);
  console.log(`ADM file: ${values.admFile}`);
  console.log(`Readable route: ${values.selectedReadableRoute ?? "Nitrado file API"}`);
  console.log(`Lines scanned: ${values.linesScanned}`);
  console.log(`Kill lines found: ${values.killLinesFound}`);
  console.log(`Existing kills skipped: ${values.existingKills}`);
  console.log(`Missing kills to add: ${values.missingKills}`);
  console.log(`Duplicate kills skipped: ${values.existingKills}`);
  console.log(`Players that would be updated: ${values.playersUpdated}`);
  console.log(`Current server total kills: ${values.currentServerTotalKills}`);
  console.log(`Expected server total kills after repair: ${values.expectedServerTotalKills}`);
  if (values.mode === "dry-run") {
    console.log("No database changes made.");
  }
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

async function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hash = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hash.slice(0, 48)}`;
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
      if (!match) continue;
      if (process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
