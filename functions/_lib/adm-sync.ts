import { parseAdmLine, parseAdmLines, type ParsedAdmEvent } from "./adm-parser";
import { getCurrentLinkedServer, requireDb, saveServerAdmPath } from "./db";
import { isMockNitrado } from "./mock";
import {
  detectNitradoAdmLogs,
  fetchReadableNitradoAdmLines,
  getAdmLogStoragePath,
  mockAdmLogDetection,
  mockNitradoLogAccessDiagnostics,
  type NitradoLogAccessDiagnostics,
  testExactNitradoAdmPath,
} from "./nitrado";
import { decryptToken } from "./crypto";
import { refreshNitradoServerMetadata } from "./server-metadata";
import type { Env } from "./types";

export type SyncLinkedServer = {
  id: string;
  user_id: string;
  nitrado_service_id: string | null;
  adm_path: string | null;
};

type AdmSyncState = {
  latest_adm_file: string | null;
  latest_adm_path: string | null;
  last_processed_file: string | null;
  last_processed_line: number | null;
  last_processed_offset: number | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  last_sync_at: string | null;
  last_lines_read: number | null;
  last_lines_processed: number | null;
  last_raw_events_stored: number | null;
  last_player_events_stored: number | null;
  last_kill_events_stored: number | null;
  last_events_created: number | null;
  last_kills_created: number | null;
  last_unknown_lines: number | null;
  last_duplicate_lines: number | null;
  last_sync_duration_ms: number | null;
  last_readable_route: string | null;
};

export type AdmSyncResult = {
  status: string;
  message: string;
  linesSeen: number;
  linesProcessed: number;
  eventsCreated: number;
  killsCreated: number;
  killsFound: number;
  newKillsCreated: number;
  duplicateKillsSkipped: number;
  playersUpdated: number;
  latestAdmFile: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
  readableRouteUsed: string | null;
  linesRead: number;
  syncStatus: string;
  rawEventsStored: number;
  playerEventsStored: number;
  killEventsStored: number;
  unknownLines: number;
  skippedDuplicateLines: number;
  syncDurationMs: number;
};

export type AdmSyncOptions = {
  triggerType?: "manual" | "scheduled";
  maxLinesPerRun?: number;
};

export type AdmSyncRunSummary = {
  id: string;
  trigger_type: "manual" | "scheduled" | string;
  status: string;
  message: string | null;
  lines_read: number;
  lines_processed: number;
  events_created: number;
  kills_created: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string | null;
};

export type AdmSyncStatus = {
  last_sync_status: string;
  last_sync_message: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_processed_line: number;
  last_sync_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  last_lines_read: number;
  last_lines_processed: number;
  last_raw_events_stored: number;
  last_player_events_stored: number;
  last_kill_events_stored: number;
  last_events_created: number;
  last_kills_created: number;
  last_unknown_lines: number;
  last_duplicate_lines: number;
  last_sync_duration_ms: number | null;
  last_readable_route: string | null;
  last_sync_trigger: string | null;
  last_scheduled_sync_at: string | null;
  last_manual_sync_at: string | null;
  recent_sync_runs: AdmSyncRunSummary[];
};

export type AdmRecentSyncEvent = {
  source: "kill" | "player";
  event_type: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
  event_label: string;
  detail: string | null;
  cause: string | null;
  object_type: string | null;
  is_mock: boolean;
};

export type ReadableAdmLinesResult = {
  lines: string[];
  newestAdmFileName: string | null;
  latestAdmPath: string | null;
  readableRouteUsed: string | null;
  diagnostics: NitradoLogAccessDiagnostics | null;
  message: string;
};

export async function runAdmSync(
  env: Env,
  userId: string,
  linkedServerId?: string | null,
  options: AdmSyncOptions = {},
): Promise<AdmSyncResult> {
  const syncStartedAt = Date.now();
  const syncStartedAtIso = new Date(syncStartedAt).toISOString();
  const triggerType = options.triggerType ?? "manual";
  const maxLinesPerRun = clampPositiveInteger(options.maxLinesPerRun ?? 50000, 50000);
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");
  const nitradoServiceId = linkedServer.nitrado_service_id;
  if (!nitradoServiceId) throw new Error("No Nitrado service selected");
  await refreshNitradoServerMetadata(env, {
    linkedServerId: linkedServer.id,
    userId: linkedServer.user_id,
    force: triggerType === "manual",
  }).catch(() => null);

  const existingState = await getSyncState(env, linkedServer.id);
  const isMock = isMockNitrado(env.MOCK_NITRADO);
  const now = new Date().toISOString();
  const readable = await getReadableAdmLinesForLinkedServer(env, linkedServer, { isMock, readMode: "full" });
  let admLog = isMock ? mockAdmLogDetection() : null;
  if (!readable.lines.length && !isMock) {
    const token = await getNitradoTokenForLinkedServer(env, linkedServer);
    admLog = linkedServer.adm_path
      ? await testExactNitradoAdmPath(token, nitradoServiceId, linkedServer.adm_path)
      : await detectNitradoAdmLogs(token, nitradoServiceId);
  }

  const latestAdmPath = readable.latestAdmPath ?? (admLog ? getAdmLogStoragePath(admLog) : null) ?? linkedServer.adm_path ?? null;
  const latestAdmFile = readable.newestAdmFileName ?? admLog?.newestAdmFileName ?? fileNameFromPath(latestAdmPath);
  if ((admLog?.admFileExists || readable.lines.length) && latestAdmPath) {
    await saveServerAdmPath(env, linkedServer.id, latestAdmPath.replace(/^\/+/, ""));
  }

  const lines = readable.lines.length ? readable.lines : getReadableAdmLines(admLog?.debug?.samplePreview ?? null);
  if (!lines.length) {
    const admAvailable = Boolean(admLog?.admFileExists || readable.newestAdmFileName);
    const message = admAvailable
      ? readable.message
      : "No ADM file is available for sync yet";
    await upsertSyncState(env, linkedServer.id, {
      latestAdmFile,
      latestAdmPath,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status: admAvailable ? "read_pending" : "not_started",
      message,
      lastSyncAt: now,
      linesRead: 0,
      linesProcessed: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      unknownLines: 0,
      duplicateLines: 0,
      syncDurationMs: Date.now() - syncStartedAt,
      readableRoute: readable.readableRouteUsed,
    });
    const syncDurationMs = Date.now() - syncStartedAt;
    await recordSyncRun(env, {
      linkedServerId: linkedServer.id,
      triggerType,
      status: admAvailable ? "read_pending" : "not_started",
      message,
      linesRead: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      startedAt: syncStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: syncDurationMs,
    });
    return {
      status: admAvailable ? "read_pending" : "not_started",
      message,
      linesSeen: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      killsFound: 0,
      newKillsCreated: 0,
      duplicateKillsSkipped: 0,
      playersUpdated: 0,
      latestAdmFile,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastSyncAt: now,
      readableRouteUsed: readable.readableRouteUsed,
      linesRead: 0,
      syncStatus: admAvailable ? "read_pending" : "not_started",
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      unknownLines: 0,
      skippedDuplicateLines: 0,
      syncDurationMs,
    };
  }

  const isSameAdmFile = Boolean(latestAdmFile && existingState?.last_processed_file === latestAdmFile);
  const lastProcessedLine = isSameAdmFile ? Number(existingState?.last_processed_line ?? 0) : 0;
  const parsedLines = parseAdmLines(lines, { admDate: extractAdmDateFromFile(latestAdmFile) ?? undefined });
  const pendingParsedEvents = parsedLines.slice(lastProcessedLine, lastProcessedLine + maxLinesPerRun);
  const creditedKillLinesFound = parsedLines.filter(isCreditedKillEvent).length;
  let eventsCreated = 0;
  let killsCreated = 0;
  let joinsCreated = 0;
  let disconnectsCreated = 0;
  let deathsCreated = 0;
  let rawEventsStored = 0;
  let playerEventsStored = 0;
  let killEventsStored = 0;
  let unknownLines = 0;
  let duplicateLines = 0;
  let processedOffset = isSameAdmFile ? Number(existingState?.last_processed_offset ?? 0) : 0;
  let lastEventAt: string | null = null;
  const recentDeathLines = new Map<string, number>();
  const warmupStart = Math.max(0, lastProcessedLine - 5);
  for (let index = warmupStart; index < lastProcessedLine; index += 1) {
    const previousEvent = parsedLines[index];
    if (previousEvent && isDeathCountingEvent(previousEvent)) {
      markDeathCounted(recentDeathLines, previousEvent, index + 1);
    }
  }

  const backfillResult = await backfillMissingCreditedKills(
    env,
    linkedServer.id,
    latestAdmFile,
    parsedLines,
    lastProcessedLine,
    recentDeathLines,
  );
  eventsCreated += backfillResult.eventsCreated;
  killEventsStored += backfillResult.killEventsCreated;
  killsCreated += backfillResult.killsCreated;
  deathsCreated += backfillResult.deathsCreated;
  duplicateLines += backfillResult.duplicatesSkipped;
  if (backfillResult.lastEventAt) lastEventAt = backfillResult.lastEventAt;

  for (let index = 0; index < pendingParsedEvents.length; index += 1) {
    const parsed = pendingParsedEvents[index];
    const rawLine = parsed.rawLine;
    const lineNumber = lastProcessedLine + index + 1;
    const rawInserted = await insertRawEvent(env, linkedServer.id, latestAdmFile, lineNumber, rawLine, parsed);
    processedOffset += rawLine.length + 1;
    if (!rawInserted) {
      duplicateLines += 1;
      continue;
    }
    rawEventsStored += 1;
    if (parsed.eventType === "unknown") unknownLines += 1;

    const eventResult = await persistParsedEvent(env, linkedServer.id, latestAdmFile, lineNumber, parsed, {
      recentDeathLines,
    });
    eventsCreated += eventResult.eventsCreated;
    playerEventsStored += eventResult.playerEventsCreated;
    killEventsStored += eventResult.killEventsCreated;
    killsCreated += eventResult.killsCreated;
    joinsCreated += eventResult.joinsCreated;
    disconnectsCreated += eventResult.disconnectsCreated;
    deathsCreated += eventResult.deathsCreated;
    lastEventAt = parsed.occurredAt ?? now;
  }

  const nextProcessedLine = lastProcessedLine + pendingParsedEvents.length;
  const syncDurationMs = Date.now() - syncStartedAt;
  const uniquePlayers = await countUniquePlayers(env, linkedServer.id);
  const creditedKillLinesConsidered =
    parsedLines.slice(0, lastProcessedLine).filter(isCreditedKillEvent).length +
    pendingParsedEvents.filter(isCreditedKillEvent).length;
  const duplicateKillsSkipped = Math.max(0, creditedKillLinesConsidered - killsCreated);
  const status = pendingParsedEvents.length || killsCreated ? "completed" : "idle";
  const message = status === "completed"
    ? `${triggerType === "manual" ? "Manual sync" : "Scheduled sync"} complete. Lines scanned: ${lines.length}. Kills found: ${creditedKillLinesFound}. New kills created: ${killsCreated}. Duplicates skipped: ${duplicateKillsSkipped}. Players updated: ${uniquePlayers}.`
    : "No new ADM lines to process";
  await upsertServerStats(env, linkedServer.id, {
    kills: killsCreated,
    deaths: deathsCreated,
    joins: joinsCreated,
    disconnects: disconnectsCreated,
    uniquePlayers,
    lastEventAt,
  });
  await upsertSyncState(env, linkedServer.id, {
    latestAdmFile,
    latestAdmPath,
    lastProcessedFile: latestAdmFile,
    lastProcessedLine: nextProcessedLine,
    lastProcessedOffset: processedOffset,
    status,
    message,
    lastSyncAt: now,
    linesRead: lines.length,
    linesProcessed: pendingParsedEvents.length,
    rawEventsStored,
    playerEventsStored,
    killEventsStored,
    eventsCreated,
    killsCreated,
    unknownLines,
    duplicateLines,
    syncDurationMs,
    readableRoute: readable.readableRouteUsed,
  });
  await recordSyncRun(env, {
    linkedServerId: linkedServer.id,
    triggerType,
    status,
    message,
    linesRead: lines.length,
    linesProcessed: pendingParsedEvents.length,
    eventsCreated,
    killsCreated,
    startedAt: syncStartedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs: syncDurationMs,
  });
  await rebuildServerStats(env, linkedServer.id);
  console.log("DZN ADM FULL SYNC COMPLETE");

  return {
    status,
    message,
    linesSeen: lines.length,
    linesProcessed: pendingParsedEvents.length,
    eventsCreated,
    killsCreated,
    killsFound: creditedKillLinesFound,
    newKillsCreated: killsCreated,
    duplicateKillsSkipped,
    playersUpdated: uniquePlayers,
    latestAdmFile,
    lastProcessedLine: nextProcessedLine,
    lastSyncAt: now,
    readableRouteUsed: readable.readableRouteUsed,
    linesRead: lines.length,
    syncStatus: status,
    rawEventsStored,
    playerEventsStored,
    killEventsStored,
    unknownLines,
    skippedDuplicateLines: duplicateLines,
    syncDurationMs,
  };
}

export async function getAdmSyncStatus(env: Env, userId: string, linkedServerId?: string | null): Promise<AdmSyncStatus> {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT
        adm_sync_state.last_sync_status,
        adm_sync_state.last_sync_message,
        adm_sync_state.latest_adm_file,
        adm_sync_state.last_processed_file,
        adm_sync_state.last_processed_line,
        adm_sync_state.last_sync_at,
        adm_sync_state.last_lines_read,
        adm_sync_state.last_lines_processed,
        adm_sync_state.last_raw_events_stored,
        adm_sync_state.last_player_events_stored,
        adm_sync_state.last_kill_events_stored,
        adm_sync_state.last_events_created,
        adm_sync_state.last_kills_created,
        adm_sync_state.last_unknown_lines,
        adm_sync_state.last_duplicate_lines,
        adm_sync_state.last_sync_duration_ms,
        adm_sync_state.last_readable_route,
        server_stats.total_kills,
        server_stats.total_deaths,
        server_stats.total_joins,
        server_stats.total_disconnects,
        server_stats.unique_players
       FROM linked_servers
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE linked_servers.id = ? AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(linkedServer.id, userId)
    .first<Record<string, unknown>>();
  const [recentRuns, lastManualRun, lastScheduledRun] = await Promise.all([
    getRecentSyncRuns(env, linkedServer.id, 5),
    getLatestSyncRunByTrigger(env, linkedServer.id, "manual"),
    getLatestSyncRunByTrigger(env, linkedServer.id, "scheduled"),
  ]);

  return {
    last_sync_status: stringOrDefault(row?.last_sync_status, "not_started"),
    last_sync_message: typeof row?.last_sync_message === "string" ? row.last_sync_message : null,
    latest_adm_file: typeof row?.latest_adm_file === "string" ? row.latest_adm_file : null,
    last_processed_file: typeof row?.last_processed_file === "string" ? row.last_processed_file : null,
    last_processed_line: numberOrZero(row?.last_processed_line),
    last_sync_at: typeof row?.last_sync_at === "string" ? row.last_sync_at : null,
    total_kills: numberOrZero(row?.total_kills),
    total_deaths: numberOrZero(row?.total_deaths),
    total_joins: numberOrZero(row?.total_joins),
    total_disconnects: numberOrZero(row?.total_disconnects),
    unique_players: numberOrZero(row?.unique_players),
    last_lines_read: numberOrZero(row?.last_lines_read),
    last_lines_processed: numberOrZero(row?.last_lines_processed),
    last_raw_events_stored: numberOrZero(row?.last_raw_events_stored),
    last_player_events_stored: numberOrZero(row?.last_player_events_stored),
    last_kill_events_stored: numberOrZero(row?.last_kill_events_stored),
    last_events_created: numberOrZero(row?.last_events_created),
    last_kills_created: numberOrZero(row?.last_kills_created),
    last_unknown_lines: numberOrZero(row?.last_unknown_lines),
    last_duplicate_lines: numberOrZero(row?.last_duplicate_lines),
    last_sync_duration_ms: row?.last_sync_duration_ms === null || row?.last_sync_duration_ms === undefined ? null : numberOrZero(row.last_sync_duration_ms),
    last_readable_route: typeof row?.last_readable_route === "string" ? row.last_readable_route : null,
    last_sync_trigger: recentRuns[0]?.trigger_type ?? null,
    last_scheduled_sync_at: lastScheduledRun?.finished_at ?? lastScheduledRun?.started_at ?? null,
    last_manual_sync_at: lastManualRun?.finished_at ?? lastManualRun?.started_at ?? null,
    recent_sync_runs: recentRuns,
  };
}

export async function getRecentAdmSyncEvents(
  env: Env,
  userId: string,
  linkedServerId?: string | null,
  limit = 10,
): Promise<AdmRecentSyncEvent[]> {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 25);
  const result = await db
    .prepare(
      `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at, raw_line
       FROM (
         SELECT
           'kill' AS source,
           'player_killed' AS event_type,
           NULL AS player_name,
           killer_name,
           victim_name,
           weapon,
           distance,
           occurred_at,
           created_at,
           raw_line,
           COALESCE(occurred_at, created_at) AS sort_time
       FROM kill_events
       WHERE linked_server_id = ?
          AND (
            ? = 1
            OR (
              COALESCE(killer_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(killer_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(killer_name, '') NOT LIKE 'MockRunner%'
              AND COALESCE(victim_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(victim_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(victim_name, '') NOT LIKE 'MockRunner%'
            )
          )

         UNION ALL

         SELECT
           'player' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           raw_line,
           COALESCE(occurred_at, created_at) AS sort_time
       FROM player_events
       WHERE linked_server_id = ?
          AND (
            ? = 1
            OR (
              COALESCE(player_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(player_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(player_name, '') NOT LIKE 'MockRunner%'
            )
          )
       )
       ORDER BY sort_time DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(linkedServer.id, isMockNitrado(env.MOCK_NITRADO) ? 1 : 0, linkedServer.id, isMockNitrado(env.MOCK_NITRADO) ? 1 : 0, safeLimit)
    .all<AdmRecentSyncEvent & { raw_line?: string | null }>();

  return (result.results ?? []).map(toSafeRecentSyncEvent);
}

function toSafeRecentSyncEvent(row: AdmRecentSyncEvent & { raw_line?: string | null }): AdmRecentSyncEvent {
  const parsed = row.raw_line ? parseAdmLine(row.raw_line) : null;
  const eventType = row.event_type || parsed?.eventType || "unknown";
  const killerName = row.killer_name ?? parsed?.killerName ?? null;
  const victimName = row.victim_name ?? parsed?.victimName ?? null;
  const playerName = row.player_name ?? parsed?.playerName ?? parsed?.victimName ?? parsed?.attackerName ?? null;
  const weapon = row.weapon ?? parsed?.weapon ?? null;
  const distance = row.distance ?? parsed?.distance ?? null;
  const cause = parsed?.cause ?? syncEventCause(eventType);
  const objectType = parsed?.objectType ?? null;
  const isKill = row.source === "kill" || eventType === "player_killed";

  return {
    source: row.source,
    event_type: eventType,
    player_name: playerName,
    killer_name: killerName,
    victim_name: victimName,
    weapon,
    distance,
    occurred_at: row.occurred_at ?? parsed?.occurredAt ?? null,
    created_at: row.created_at,
    event_label: syncEventLabel(eventType, isKill),
    detail: syncEventDetail({
      eventType,
      isKill,
      playerName,
      killerName,
      victimName,
      attackerName: parsed?.attackerName ?? null,
      weapon,
      cause,
      objectType,
    }),
    cause,
    object_type: objectType,
    is_mock: [playerName, killerName, victimName, parsed?.attackerName].some(isMockPlayerName),
  };
}

function syncEventLabel(eventType: string, isKill: boolean) {
  if (isKill) return "PvP Kill";
  const labels: Record<string, string> = {
    player_connected: "Connected",
    player_disconnected: "Disconnected",
    player_died_stats: "Died",
    player_killed_environment: "Died",
    player_suicide: "Suicide",
    player_hit: "Hit",
    player_hit_explosion: "Hit",
    player_hit_unknown_attacker: "Hit",
    player_placed_object: "Placed Object",
    player_connecting: "Connecting",
    player_unconscious: "Unconscious",
    player_regained_consciousness: "Regained Consciousness",
    player_choosing_respawn: "Choosing Respawn",
    player_performed_action: "Action",
    playerlist_entry: "Player Snapshot",
    plain_player_state: "Player Snapshot",
  };
  return labels[eventType] ?? formatSyncEventType(eventType);
}

function syncEventCause(eventType: string) {
  if (eventType === "player_suicide") return "Suicide";
  if (eventType === "player_died_stats") return "Death stats";
  return null;
}

function syncEventDetail(values: {
  eventType: string;
  isKill: boolean;
  playerName: string | null;
  killerName: string | null;
  victimName: string | null;
  attackerName: string | null;
  weapon: string | null;
  cause: string | null;
  objectType: string | null;
}) {
  if (values.isKill) return `${values.killerName ?? "Unknown"} -> ${values.victimName ?? "Unknown"}`;
  if (values.eventType === "player_hit") return `${values.attackerName ?? "Unknown"} hit ${values.victimName ?? values.playerName ?? "Unknown"}`;
  if (values.eventType === "player_hit_explosion") return `${values.playerName ?? "Unknown"} hit by explosion`;
  if (values.eventType === "player_hit_unknown_attacker") return `${values.playerName ?? values.victimName ?? "Unknown"} hit by unknown attacker`;
  if (values.eventType === "player_killed_environment") return `${values.victimName ?? values.playerName ?? "Unknown"} died${values.cause ? `: ${values.cause}` : ""}`;
  if (values.eventType === "player_suicide") return `${values.playerName ?? "Unknown"} committed suicide`;
  if (values.eventType === "player_placed_object") return `${values.playerName ?? "Unknown"} placed ${values.objectType ?? "an object"}`;
  return values.playerName ?? values.victimName ?? null;
}

function formatSyncEventType(value: string) {
  return value
    .replace(/^player_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isMockPlayerName(value: string | null | undefined) {
  return /^Mock(Survivor|Bandit|Runner)/.test(value ?? "");
}

export async function clearMockTestSyncData(env: Env, userId: string, linkedServerId?: string | null) {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  await db
    .prepare(
      `DELETE FROM adm_raw_events
       WHERE linked_server_id = ?
         AND (
           raw_line LIKE '%MockSurvivor%'
           OR raw_line LIKE '%MockBandit%'
           OR raw_line LIKE '%MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM kill_events
       WHERE linked_server_id = ?
         AND (
           COALESCE(killer_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(killer_name, '') LIKE 'MockBandit%'
           OR COALESCE(killer_name, '') LIKE 'MockRunner%'
           OR COALESCE(victim_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(victim_name, '') LIKE 'MockBandit%'
           OR COALESCE(victim_name, '') LIKE 'MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM player_events
       WHERE linked_server_id = ?
         AND (
           COALESCE(player_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(player_name, '') LIKE 'MockBandit%'
           OR COALESCE(player_name, '') LIKE 'MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM player_profiles
       WHERE linked_server_id = ?
         AND (
           player_name LIKE 'MockSurvivor%'
           OR player_name LIKE 'MockBandit%'
           OR player_name LIKE 'MockRunner%'
           OR COALESCE(player_id, '') LIKE 'mock-player-%'
         )`,
    )
    .bind(linkedServer.id)
    .run();

  const remaining = await countRemainingSyncRows(env, linkedServer.id);
  if (remaining === 0) {
    await db.prepare("DELETE FROM server_stats WHERE linked_server_id = ?").bind(linkedServer.id).run();
    await db.prepare("DELETE FROM adm_sync_state WHERE linked_server_id = ?").bind(linkedServer.id).run();
  } else {
    await rebuildServerStats(env, linkedServer.id);
  }

  return { ok: true, remainingRows: remaining };
}

export async function clearOldFailedSyncRuns(env: Env, userId: string, linkedServerId?: string | null) {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  const latestSuccess = await db
    .prepare(
      `SELECT COALESCE(finished_at, started_at, created_at) AS sync_time
       FROM sync_runs
       WHERE linked_server_id = ?
         AND lower(status) IN ('completed', 'idle')
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT 1`,
    )
    .bind(linkedServer.id)
    .first<{ sync_time: string | null }>();

  if (!latestSuccess?.sync_time) {
    return { ok: true, deletedCount: 0 };
  }

  const result = await db
    .prepare(
      `DELETE FROM sync_runs
       WHERE linked_server_id = ?
         AND lower(status) IN ('error', 'failed')
         AND COALESCE(finished_at, started_at, created_at) < ?`,
    )
    .bind(linkedServer.id, latestSuccess.sync_time)
    .run();

  return { ok: true, deletedCount: numberOrZero(result.meta?.changes) };
}

export type ScheduledAdmSyncResult = {
  ok: true;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cron: string | null;
  maxServers: number;
  maxLinesPerServer: number;
};

export async function runScheduledAdmSync(
  env: Env,
  options: {
    cron?: string | null;
    maxServers?: number;
    maxLinesPerServer?: number;
    minSyncIntervalMs?: number;
  } = {},
): Promise<ScheduledAdmSyncResult> {
  await ensureAdmSyncSchema(env);
  const maxServers = clampPositiveInteger(options.maxServers ?? 10, 10);
  const maxLinesPerServer = clampPositiveInteger(options.maxLinesPerServer ?? 50000, 50000);
  const minSyncIntervalMs = clampPositiveInteger(options.minSyncIntervalMs ?? 120000, 120000);
  const eligibleServers = await getEligibleScheduledSyncServers(env, maxServers, minSyncIntervalMs);
  let succeeded = 0;
  let failed = 0;

  for (const server of eligibleServers) {
    try {
      await runAdmSync(env, server.user_id, server.id, {
        triggerType: "scheduled",
        maxLinesPerRun: maxLinesPerServer,
      });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      await recordSyncRun(env, {
        linkedServerId: server.id,
        triggerType: "scheduled",
        status: "error",
        message: safeSyncErrorMessage(error),
        linesRead: 0,
        linesProcessed: 0,
        eventsCreated: 0,
        killsCreated: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      });
    }
  }

  return {
    ok: true,
    processed: eligibleServers.length,
    succeeded,
    failed,
    skipped: Math.max(0, maxServers - eligibleServers.length),
    cron: options.cron ?? null,
    maxServers,
    maxLinesPerServer,
  };
}

export async function ensureAdmSyncSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of ADM_SYNC_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
  await ensureAdmSyncDetailColumns(env);
}

async function getOwnedLinkedServer(env: Env, userId: string, linkedServerId?: string | null): Promise<SyncLinkedServer | null> {
  if (!linkedServerId) {
    const current = await getCurrentLinkedServer(env, userId, { includePrivateAdmPath: true });
    if (!current || typeof current.id !== "string") return null;
    return {
      id: current.id,
      user_id: userId,
      nitrado_service_id: typeof current.nitrado_service_id === "string" ? current.nitrado_service_id : null,
      adm_path: typeof current.adm_path === "string" ? current.adm_path : null,
    };
  }

  const db = requireDb(env);
  return db
    .prepare(
      `SELECT linked_servers.id, linked_servers.user_id, linked_servers.nitrado_service_id, server_log_config.adm_path AS adm_path
       FROM linked_servers
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       WHERE linked_servers.id = ? AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId, userId)
    .first<SyncLinkedServer>();
}

async function getEligibleScheduledSyncServers(env: Env, limit: number, minSyncIntervalMs: number) {
  const db = requireDb(env);
  const minSyncIntervalSeconds = Math.max(1, Math.floor(minSyncIntervalMs / 1000));
  const result = await db
    .prepare(
      `SELECT linked_servers.id, linked_servers.user_id, linked_servers.nitrado_service_id, server_log_config.adm_path AS adm_path
       FROM linked_servers
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND (
           server_log_config.adm_path IS NOT NULL
           OR onboarding_checks.adm_logs_found = 1
           OR adm_sync_state.last_sync_status IN ('completed', 'idle', 'read_pending', 'active')
         )
         AND (
           adm_sync_state.last_sync_at IS NULL
           OR (strftime('%s', 'now') - strftime('%s', adm_sync_state.last_sync_at)) >= ?
         )
       ORDER BY COALESCE(adm_sync_state.last_sync_at, '1970-01-01T00:00:00.000Z') ASC,
                linked_servers.updated_at DESC
       LIMIT ?`,
    )
    .bind(minSyncIntervalSeconds, limit)
    .all<SyncLinkedServer>();

  return result.results ?? [];
}

async function ensureAdmSyncDetailColumns(env: Env) {
  const db = requireDb(env);
  const columns = await db.prepare("PRAGMA table_info(adm_sync_state)").all<{ name: string }>();
  const existing = new Set((columns.results ?? []).map((column) => column.name));
  const missingColumns = [
    ["last_lines_read", "INTEGER DEFAULT 0"],
    ["last_lines_processed", "INTEGER DEFAULT 0"],
    ["last_raw_events_stored", "INTEGER DEFAULT 0"],
    ["last_player_events_stored", "INTEGER DEFAULT 0"],
    ["last_kill_events_stored", "INTEGER DEFAULT 0"],
    ["last_events_created", "INTEGER DEFAULT 0"],
    ["last_kills_created", "INTEGER DEFAULT 0"],
    ["last_unknown_lines", "INTEGER DEFAULT 0"],
    ["last_duplicate_lines", "INTEGER DEFAULT 0"],
    ["last_sync_duration_ms", "INTEGER"],
    ["last_readable_route", "TEXT"],
  ].filter(([name]) => !existing.has(name));

  for (const [name, type] of missingColumns) {
    await db.prepare(`ALTER TABLE adm_sync_state ADD COLUMN ${name} ${type}`).run();
  }
}

async function getSyncState(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  return db
    .prepare("SELECT * FROM adm_sync_state WHERE linked_server_id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<AdmSyncState>();
}

async function upsertSyncState(
  env: Env,
  linkedServerId: string,
  values: {
    latestAdmFile: string | null;
    latestAdmPath: string | null;
    lastProcessedFile: string | null;
    lastProcessedLine: number;
    lastProcessedOffset: number;
    status: string;
    message: string;
    lastSyncAt: string;
    linesRead: number;
    linesProcessed: number;
    rawEventsStored: number;
    playerEventsStored: number;
    killEventsStored: number;
    eventsCreated: number;
    killsCreated: number;
    unknownLines: number;
    duplicateLines: number;
    syncDurationMs: number;
    readableRoute: string | null;
  },
) {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO adm_sync_state (
        id, linked_server_id, latest_adm_file, latest_adm_path, last_processed_file,
        last_processed_line, last_processed_offset, last_sync_status, last_sync_message,
        last_sync_at, last_lines_read, last_lines_processed, last_raw_events_stored,
        last_player_events_stored, last_kill_events_stored, last_events_created,
        last_kills_created, last_unknown_lines, last_duplicate_lines, last_sync_duration_ms,
        last_readable_route, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        latest_adm_file = excluded.latest_adm_file,
        latest_adm_path = excluded.latest_adm_path,
        last_processed_file = excluded.last_processed_file,
        last_processed_line = excluded.last_processed_line,
        last_processed_offset = excluded.last_processed_offset,
        last_sync_status = excluded.last_sync_status,
        last_sync_message = excluded.last_sync_message,
        last_sync_at = excluded.last_sync_at,
        last_lines_read = excluded.last_lines_read,
        last_lines_processed = excluded.last_lines_processed,
        last_raw_events_stored = excluded.last_raw_events_stored,
        last_player_events_stored = excluded.last_player_events_stored,
        last_kill_events_stored = excluded.last_kill_events_stored,
        last_events_created = excluded.last_events_created,
        last_kills_created = excluded.last_kills_created,
        last_unknown_lines = excluded.last_unknown_lines,
        last_duplicate_lines = excluded.last_duplicate_lines,
        last_sync_duration_ms = excluded.last_sync_duration_ms,
        last_readable_route = excluded.last_readable_route,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      values.latestAdmFile,
      values.latestAdmPath,
      values.lastProcessedFile,
      values.lastProcessedLine,
      values.lastProcessedOffset,
      values.status,
      values.message,
      values.lastSyncAt,
      values.linesRead,
      values.linesProcessed,
      values.rawEventsStored,
      values.playerEventsStored,
      values.killEventsStored,
      values.eventsCreated,
      values.killsCreated,
      values.unknownLines,
      values.duplicateLines,
      values.syncDurationMs,
      values.readableRoute,
    )
    .run();
}

async function insertRawEvent(
  env: Env,
  linkedServerId: string,
  admFile: string | null,
  lineNumber: number,
  rawLine: string,
  parsed: ParsedAdmEvent,
) {
  const db = requireDb(env);
  const id = await stableSyncId("raw", linkedServerId, admFile, lineNumber);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO adm_raw_events (
        id, linked_server_id, adm_file, line_number, raw_line, event_type, parsed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      linkedServerId,
      admFile,
      lineNumber,
      rawLine,
      parsed.eventType,
      parsed.eventType === "unknown" ? 0 : 1,
    )
    .run();
  return didMutate(result);
}

async function persistParsedEvent(
  env: Env,
  linkedServerId: string,
  admFile: string | null,
  lineNumber: number,
  parsed: ParsedAdmEvent,
  context: { recentDeathLines: Map<string, number> },
) {
  if (
    parsed.eventType === "admin_log_started" ||
    parsed.eventType === "playerlist_snapshot" ||
    parsed.eventType === "playerlist_delimiter" ||
    parsed.eventType === "unknown"
  ) {
    return emptyPersistResult();
  }

  if (parsed.eventType === "playerlist_entry" || parsed.eventType === "plain_player_state") {
    let playerProfileId: string | null = null;
    if (parsed.playerName) {
      playerProfileId = await upsertPlayerProfile(env, linkedServerId, parsed.playerName, parsed.playerId, parsed.occurredAt);
    }
    const inserted = await insertPlayerEvent(env, linkedServerId, playerProfileId, admFile, lineNumber, parsed);
    return {
      ...emptyPersistResult(),
      eventsCreated: inserted ? 1 : 0,
      playerEventsCreated: inserted ? 1 : 0,
    };
  }

  const result = emptyPersistResult();

  if (parsed.eventType === "player_killed" && parsed.isCreditedKill) {
    const killerProfileId = parsed.killerName
      ? await upsertPlayerProfile(env, linkedServerId, parsed.killerName, parsed.killerId, parsed.occurredAt)
      : null;
    const victimProfileId = parsed.victimName
      ? await upsertPlayerProfile(env, linkedServerId, parsed.victimName, parsed.victimId, parsed.occurredAt)
      : null;
    const inserted = await insertKillEvent(env, linkedServerId, killerProfileId, victimProfileId, admFile, lineNumber, parsed);
    if (inserted) {
      await updateProfilesForDeath(env, {
        killerProfileId,
        victimProfileId,
        killerGetsKill: true,
        suicide: false,
        distance: parsed.distance,
      });
      result.eventsCreated = 1;
      result.killEventsCreated = 1;
      result.killsCreated = 1;
      result.deathsCreated = 1;
    }
    markDeathCounted(context.recentDeathLines, parsed, lineNumber);
    return result;
  }

  const eventPlayer = getPlayerForPlayerEvent(parsed);
  let playerProfileId: string | null = null;
  if (eventPlayer.name) {
    playerProfileId = await upsertPlayerProfile(env, linkedServerId, eventPlayer.name, eventPlayer.id, parsed.occurredAt);
  }

  const inserted = await insertPlayerEvent(env, linkedServerId, playerProfileId, admFile, lineNumber, parsed);
  if (!inserted) return result;

  result.eventsCreated = 1;
  result.playerEventsCreated = 1;

  if (parsed.eventType === "player_connected") result.joinsCreated = 1;
  if (parsed.eventType === "player_disconnected") result.disconnectsCreated = 1;

  if (parsed.eventType === "player_killed_environment" || parsed.eventType === "player_suicide") {
    const victimProfileId = eventPlayer.name
      ? await upsertPlayerProfile(env, linkedServerId, eventPlayer.name, eventPlayer.id, parsed.occurredAt)
      : playerProfileId;
    await updateProfilesForDeath(env, {
      killerProfileId: null,
      victimProfileId,
      killerGetsKill: false,
      suicide: parsed.eventType === "player_suicide",
      distance: null,
    });
    markDeathCounted(context.recentDeathLines, parsed, lineNumber);
    result.deathsCreated = 1;
  }

  if (parsed.eventType === "player_died_stats") {
    const deathAlreadyCounted = wasDeathRecentlyCounted(context.recentDeathLines, parsed, lineNumber);
    if (!deathAlreadyCounted) {
      await updateProfilesForDeath(env, {
        killerProfileId: null,
        victimProfileId: playerProfileId,
        killerGetsKill: false,
        suicide: false,
        distance: null,
      });
      markDeathCounted(context.recentDeathLines, parsed, lineNumber);
      result.deathsCreated = 1;
    }
  }

  return result;
}

async function backfillMissingCreditedKills(
  env: Env,
  linkedServerId: string,
  admFile: string | null,
  parsedLines: ParsedAdmEvent[],
  processedLineCount: number,
  recentDeathLines: Map<string, number>,
) {
  const result = {
    eventsCreated: 0,
    killEventsCreated: 0,
    killsCreated: 0,
    deathsCreated: 0,
    duplicatesSkipped: 0,
    lastEventAt: null as string | null,
  };
  const backfillLimit = Math.min(Math.max(0, processedLineCount), parsedLines.length);

  for (let index = 0; index < backfillLimit; index += 1) {
    const parsed = parsedLines[index];
    if (!parsed || !isCreditedKillEvent(parsed)) continue;

    const lineNumber = index + 1;
    const eventResult = await persistParsedEvent(env, linkedServerId, admFile, lineNumber, parsed, { recentDeathLines });
    if (eventResult.killsCreated > 0) {
      result.eventsCreated += eventResult.eventsCreated;
      result.killEventsCreated += eventResult.killEventsCreated;
      result.killsCreated += eventResult.killsCreated;
      result.deathsCreated += eventResult.deathsCreated;
      result.lastEventAt = parsed.occurredAt ?? result.lastEventAt;
    } else {
      result.duplicatesSkipped += 1;
    }
  }

  return result;
}

async function insertPlayerEvent(
  env: Env,
  linkedServerId: string,
  playerProfileId: string | null,
  admFile: string | null,
  lineNumber: number,
  parsed: ParsedAdmEvent,
) {
  const db = requireDb(env);
  const id = await stableSyncId("player-event", linkedServerId, admFile, lineNumber, parsed.eventType);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO player_events (
        id, linked_server_id, player_profile_id, player_name, player_id, event_type,
        position_x, position_y, position_z, adm_file, line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      linkedServerId,
      playerProfileId,
      parsed.playerName,
      parsed.playerId,
      parsed.eventType,
      parsed.position?.x ?? null,
      parsed.position?.y ?? null,
      parsed.position?.z ?? null,
      admFile,
      lineNumber,
      parsed.occurredAt,
      parsed.rawLine,
    )
    .run();
  return didMutate(result);
}

async function insertKillEvent(
  env: Env,
  linkedServerId: string,
  killerProfileId: string | null,
  victimProfileId: string | null,
  admFile: string | null,
  lineNumber: number,
  parsed: ParsedAdmEvent,
) {
  const db = requireDb(env);
  if (await hasExistingKillEventByFallback(env, linkedServerId, parsed)) return false;
  const id = await stableSyncId("kill-event", linkedServerId, admFile, lineNumber);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO kill_events (
        id, linked_server_id, killer_profile_id, victim_profile_id, killer_name, victim_name,
        killer_id, victim_id, weapon, distance, position_x, position_y, position_z,
        adm_file, line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      linkedServerId,
      killerProfileId,
      victimProfileId,
      parsed.killerName ?? parsed.playerName,
      parsed.victimName,
      parsed.killerId ?? parsed.playerId,
      parsed.victimId,
      parsed.weapon,
      parsed.distance,
      parsed.killerPosition?.x ?? parsed.position?.x ?? null,
      parsed.killerPosition?.y ?? parsed.position?.y ?? null,
      parsed.killerPosition?.z ?? parsed.position?.z ?? null,
      admFile,
      lineNumber,
      parsed.occurredAt,
      parsed.rawLine,
    )
    .run();
  return didMutate(result);
}

async function hasExistingKillEventByFallback(env: Env, linkedServerId: string, parsed: ParsedAdmEvent) {
  const killer = parsed.killerId ?? parsed.killerName ?? parsed.playerId ?? parsed.playerName ?? "";
  const victim = parsed.victimId ?? parsed.victimName ?? "";
  if (!killer || !victim) return false;

  const db = requireDb(env);
  const distance = parsed.distance;
  const row = await db
    .prepare(
      `SELECT id
       FROM kill_events
       WHERE linked_server_id = ?
         AND COALESCE(occurred_at, '') = COALESCE(?, '')
         AND COALESCE(killer_id, killer_name, '') = ?
         AND COALESCE(victim_id, victim_name, '') = ?
         AND COALESCE(weapon, '') = COALESCE(?, '')
         AND (
           (? IS NULL AND distance IS NULL)
           OR ABS(COALESCE(distance, -9999999) - COALESCE(?, -9999999)) < 0.0001
         )
       LIMIT 1`,
    )
    .bind(
      linkedServerId,
      parsed.occurredAt,
      killer,
      victim,
      parsed.weapon,
      distance,
      distance,
    )
    .first<{ id: string }>();

  return Boolean(row?.id);
}

async function upsertPlayerProfile(
  env: Env,
  linkedServerId: string,
  playerName: string,
  playerId: string | null,
  lastSeenAt: string | null,
) {
  const db = requireDb(env);
  const existing = playerId
    ? await db
      .prepare("SELECT id FROM player_profiles WHERE linked_server_id = ? AND player_id = ? LIMIT 1")
      .bind(linkedServerId, playerId)
      .first<{ id: string }>()
    : await db
      .prepare("SELECT id FROM player_profiles WHERE linked_server_id = ? AND lower(player_name) = lower(?) LIMIT 1")
      .bind(linkedServerId, playerName)
      .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          player_name = ?,
          player_id = COALESCE(?, player_id),
          last_seen_at = COALESCE(?, last_seen_at),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(playerName, playerId, lastSeenAt, existing.id)
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO player_profiles (
        id, linked_server_id, player_name, player_id, last_seen_at, first_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(id, linkedServerId, playerName, playerId, lastSeenAt)
    .run();
  return id;
}

async function updateProfilesForDeath(
  env: Env,
  values: {
    killerProfileId: string | null;
    victimProfileId: string | null;
    killerGetsKill: boolean;
    suicide: boolean;
    distance: number | null;
  },
) {
  const db = requireDb(env);
  if (values.killerProfileId && values.killerGetsKill) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          kills = kills + 1,
          longest_kill_distance = MAX(longest_kill_distance, ?),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(values.distance ?? 0, values.killerProfileId)
      .run();
  }
  if (values.victimProfileId) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          deaths = deaths + 1,
          suicides = suicides + ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(values.suicide ? 1 : 0, values.victimProfileId)
      .run();
  }
}

async function upsertServerStats(
  env: Env,
  linkedServerId: string,
  increments: {
    kills: number;
    deaths: number;
    joins: number;
    disconnects: number;
    uniquePlayers: number;
    lastEventAt: string | null;
  },
) {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO server_stats (
        id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects,
        unique_players, last_event_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        total_kills = total_kills + excluded.total_kills,
        total_deaths = total_deaths + excluded.total_deaths,
        total_joins = total_joins + excluded.total_joins,
        total_disconnects = total_disconnects + excluded.total_disconnects,
        unique_players = excluded.unique_players,
        last_event_at = COALESCE(excluded.last_event_at, server_stats.last_event_at),
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      increments.kills,
      increments.deaths,
      increments.joins,
      increments.disconnects,
      increments.uniquePlayers,
      increments.lastEventAt,
    )
    .run();
}

async function countUniquePlayers(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM player_profiles WHERE linked_server_id = ?")
    .bind(linkedServerId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function getNitradoTokenForLinkedServer(env: Env, linkedServer: SyncLinkedServer) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ? AND linked_server_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(linkedServer.user_id, linkedServer.id)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();

  if (!row) throw new Error("No Nitrado token found for this linked server");
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

async function countRemainingSyncRows(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const [raw, playerEvents, killEvents, profiles] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM adm_raw_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_profiles WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
  ]);
  return numberOrZero(raw?.count) + numberOrZero(playerEvents?.count) + numberOrZero(killEvents?.count) + numberOrZero(profiles?.count);
}

async function rebuildServerStats(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const [kills, deathsFromKills, deathsFromPlayerEvents, joins, disconnects, uniquePlayers, lastEvent] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ? AND victim_name IS NOT NULL").bind(linkedServerId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM player_events
         WHERE linked_server_id = ?
           AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')`,
      )
      .bind(linkedServerId)
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ? AND event_type = 'player_connected'").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ? AND event_type = 'player_disconnected'").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_profiles WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT MAX(COALESCE(occurred_at, created_at)) AS last_event_at
         FROM (
           SELECT occurred_at, created_at FROM player_events WHERE linked_server_id = ?
           UNION ALL
           SELECT occurred_at, created_at FROM kill_events WHERE linked_server_id = ?
         )`,
      )
      .bind(linkedServerId, linkedServerId)
      .first<{ last_event_at: string | null }>(),
  ]);

  await db
    .prepare(
      `INSERT INTO server_stats (
        id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects,
        unique_players, last_event_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        total_kills = excluded.total_kills,
        total_deaths = excluded.total_deaths,
        total_joins = excluded.total_joins,
        total_disconnects = excluded.total_disconnects,
        unique_players = excluded.unique_players,
        last_event_at = excluded.last_event_at,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      numberOrZero(kills?.count),
      numberOrZero(deathsFromKills?.count) + numberOrZero(deathsFromPlayerEvents?.count),
      numberOrZero(joins?.count),
      numberOrZero(disconnects?.count),
      numberOrZero(uniquePlayers?.count),
      lastEvent?.last_event_at ?? null,
    )
    .run();
}

export async function recordSyncRun(
  env: Env,
  values: {
    linkedServerId: string | null;
    triggerType: "manual" | "scheduled";
    status: string;
    message: string | null;
    linesRead: number;
    linesProcessed: number;
    eventsCreated: number;
    killsCreated: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  },
) {
  await ensureAdmSyncSchema(env);
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO sync_runs (
        id, linked_server_id, trigger_type, status, message, lines_read, lines_processed,
        events_created, kills_created, started_at, finished_at, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      crypto.randomUUID(),
      values.linkedServerId,
      values.triggerType,
      values.status,
      values.message,
      values.linesRead,
      values.linesProcessed,
      values.eventsCreated,
      values.killsCreated,
      values.startedAt,
      values.finishedAt,
      values.durationMs,
    )
    .run();
}

async function getRecentSyncRuns(env: Env, linkedServerId: string, limit: number) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT id, trigger_type, status, message, lines_read, lines_processed, events_created,
              kills_created, started_at, finished_at, duration_ms, created_at
       FROM sync_runs
       WHERE linked_server_id = ?
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT ?`,
    )
    .bind(linkedServerId, limit)
    .all<AdmSyncRunSummary>();

  return (result.results ?? []).map(mapSyncRunSummary);
}

async function getLatestSyncRunByTrigger(env: Env, linkedServerId: string, triggerType: "manual" | "scheduled") {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT id, trigger_type, status, message, lines_read, lines_processed, events_created,
              kills_created, started_at, finished_at, duration_ms, created_at
       FROM sync_runs
       WHERE linked_server_id = ? AND trigger_type = ?
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT 1`,
    )
    .bind(linkedServerId, triggerType)
    .first<AdmSyncRunSummary>();

  return row ? mapSyncRunSummary(row) : null;
}

function mapSyncRunSummary(row: AdmSyncRunSummary): AdmSyncRunSummary {
  return {
    id: row.id,
    trigger_type: row.trigger_type,
    status: row.status,
    message: row.message,
    lines_read: numberOrZero(row.lines_read),
    lines_processed: numberOrZero(row.lines_processed),
    events_created: numberOrZero(row.events_created),
    kills_created: numberOrZero(row.kills_created),
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms === null || row.duration_ms === undefined ? null : numberOrZero(row.duration_ms),
    created_at: row.created_at,
  };
}

function getReadableAdmLines(samplePreview: string | null) {
  if (!samplePreview) return [];
  return samplePreview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getReadableAdmLinesForLinkedServer(
  env: Env,
  linkedServer: SyncLinkedServer,
  options: { isMock?: boolean; readMode?: "sample" | "full" } = {},
): Promise<ReadableAdmLinesResult> {
  const isMock = options.isMock ?? isMockNitrado(env.MOCK_NITRADO);
  if (isMock) {
    const diagnostics = mockNitradoLogAccessDiagnostics(linkedServer.nitrado_service_id ?? "mock-service");
    return {
      lines: mockAdmLines(),
      newestAdmFileName: diagnostics.newestAdmFileName,
      latestAdmPath: "dayzps/config/DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
      readableRouteUsed: diagnostics.readable.routeRecommendation,
      diagnostics,
      message: "Mock ADM lines loaded through parser sync path",
    };
  }

  if (!linkedServer.nitrado_service_id) {
    return {
      lines: [],
      newestAdmFileName: null,
      latestAdmPath: linkedServer.adm_path,
      readableRouteUsed: null,
      diagnostics: null,
      message: "No Nitrado token or service ID is available for ADM log reading.",
    };
  }

  const token = await getNitradoTokenForLinkedServer(env, linkedServer);
  const readable = await fetchReadableNitradoAdmLines(token, linkedServer.nitrado_service_id, { mode: options.readMode ?? "sample" });
  if (readable.diagnostics.readable.found && !readable.lines.length) {
    throw new Error("Diagnostics could read ADM lines, but sync helper failed to process them.");
  }

  if (readable.lines.length) {
    return {
      lines: readable.lines,
      newestAdmFileName: readable.diagnostics.newestAdmFileName,
      latestAdmPath: linkedServer.adm_path,
      readableRouteUsed: readable.diagnostics.readable.routeRecommendation,
      diagnostics: readable.diagnostics,
      message: `ADM lines readable via ${readable.diagnostics.readable.sourceLabel ?? "Nitrado diagnostics"}`,
    };
  }

  return {
    lines: [],
    newestAdmFileName: readable.diagnostics.newestAdmFileName,
    latestAdmPath: linkedServer.adm_path,
    readableRouteUsed: readable.diagnostics.readable.routeRecommendation,
    diagnostics: readable.diagnostics,
    message: readable.diagnostics.readable.message,
  };
}

function mockAdmLines() {
  return [
    "AdminLog started on 2026-05-14 at 13:45:00",
    "13:45:05 | Player \"MockSurvivor\" (id=mock-player-1) is connecting",
    "13:45:10 | Player \"MockSurvivor\" (id=mock-player-1 pos=<123.4, 456.7, 89.0>) is connected",
    "13:45:12 | Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 490.0, 92.0>) is connected",
    "13:45:35 | Player \"MockSurvivor\" (id=mock-player-1 pos=<124.0, 457.0, 89.1>) placed Fireplace",
    "13:46:09 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>)[HP: 0] hit by Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 490.0, 92.0>) into Head(0) for 30.5 damage (Bullet_556x45) with M4A1 from 72.5 meters",
    "13:46:10 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>) killed by Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 490.0, 92.0>) with M4A1 from 72.5 meters",
    "13:46:11 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>) died. Stats> Water: 582.795 Energy: 582.795 Bleed sources: 0",
    "13:47:00 | Player \"MockRunner\" (id=mock-player-3 pos=<150.0, 500.0, 94.0>) is connected",
    "13:47:40 | Player \"MockRunner\" (id=mock-player-3 pos=<151.0, 501.0, 94.2>) committed suicide",
    "13:48:00 | Player \"MockBandit\" (id=mock-player-2 pos=<141.0, 491.0, 92.0>) has been disconnected",
    "13:48:02 | ##### PlayerList log: 2 players",
    "13:48:02 | #####",
    "13:48:02 | Player \"MockBandit\" (id=mock-player-2 pos=<141.0, 491.0, 92.0>)",
    "13:48:02 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>)",
  ];
}

function fileNameFromPath(path: string | null) {
  return path ? path.split("/").filter(Boolean).at(-1) ?? null : null;
}

async function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hash = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hash.slice(0, 48)}`;
}

function didMutate(result: { meta?: { changes?: number } }) {
  return Number(result.meta?.changes ?? 0) > 0;
}

function extractAdmDateFromFile(fileName: string | null) {
  const match = fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName) : null;
  return match?.[1] ?? null;
}

function getPlayerForPlayerEvent(parsed: ParsedAdmEvent) {
  if (parsed.playerName) return { name: parsed.playerName, id: parsed.playerId };
  if (parsed.victimName) return { name: parsed.victimName, id: parsed.victimId };
  if (parsed.attackerName) return { name: parsed.attackerName, id: parsed.attackerId };
  return { name: null, id: null };
}

function getDeathKey(parsed: ParsedAdmEvent) {
  const id = parsed.victimId ?? parsed.playerId;
  if (id) return `id:${id}`;
  const name = parsed.victimName ?? parsed.playerName;
  return name ? `name:${name.toLowerCase()}` : null;
}

function markDeathCounted(recentDeathLines: Map<string, number>, parsed: ParsedAdmEvent, lineNumber: number) {
  const key = getDeathKey(parsed);
  if (key) recentDeathLines.set(key, lineNumber);
}

function wasDeathRecentlyCounted(recentDeathLines: Map<string, number>, parsed: ParsedAdmEvent, lineNumber: number) {
  const key = getDeathKey(parsed);
  if (!key) return false;
  const previousLine = recentDeathLines.get(key);
  return typeof previousLine === "number" && lineNumber - previousLine <= 5;
}

function isDeathCountingEvent(parsed: ParsedAdmEvent) {
  return (
    isCreditedKillEvent(parsed) ||
    parsed.eventType === "player_killed_environment" ||
    parsed.eventType === "player_suicide" ||
    parsed.eventType === "player_died_stats"
  );
}

function isCreditedKillEvent(parsed: ParsedAdmEvent) {
  return parsed.eventType === "player_killed" && parsed.isCreditedKill;
}

function emptyPersistResult() {
  return {
    eventsCreated: 0,
    playerEventsCreated: 0,
    killEventsCreated: 0,
    killsCreated: 0,
    joinsCreated: 0,
    disconnectsCreated: 0,
    deathsCreated: 0,
  };
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function clampPositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function safeSyncErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Scheduled sync failed";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .slice(0, 500);
}

const ADM_SYNC_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS adm_sync_state (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL UNIQUE,
    latest_adm_file TEXT,
    latest_adm_path TEXT,
    last_processed_file TEXT,
    last_processed_line INTEGER DEFAULT 0,
    last_processed_offset INTEGER DEFAULT 0,
    last_sync_status TEXT DEFAULT 'not_started',
    last_sync_message TEXT,
    last_sync_at TEXT,
    last_lines_read INTEGER DEFAULT 0,
    last_lines_processed INTEGER DEFAULT 0,
    last_raw_events_stored INTEGER DEFAULT 0,
    last_player_events_stored INTEGER DEFAULT 0,
    last_kill_events_stored INTEGER DEFAULT 0,
    last_events_created INTEGER DEFAULT 0,
    last_kills_created INTEGER DEFAULT 0,
    last_unknown_lines INTEGER DEFAULT 0,
    last_duplicate_lines INTEGER DEFAULT 0,
    last_sync_duration_ms INTEGER,
    last_readable_route TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS adm_raw_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    adm_file TEXT,
    line_number INTEGER,
    raw_line TEXT NOT NULL,
    event_type TEXT,
    parsed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS player_profiles (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    player_id TEXT,
    discord_id TEXT,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    suicides INTEGER DEFAULT 0,
    longest_kill_distance REAL DEFAULT 0,
    last_seen_at TEXT,
    first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS player_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    player_profile_id TEXT,
    player_name TEXT,
    player_id TEXT,
    event_type TEXT NOT NULL,
    position_x REAL,
    position_y REAL,
    position_z REAL,
    adm_file TEXT,
    line_number INTEGER,
    occurred_at TEXT,
    raw_line TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS kill_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    killer_profile_id TEXT,
    victim_profile_id TEXT,
    killer_name TEXT,
    victim_name TEXT,
    killer_id TEXT,
    victim_id TEXT,
    weapon TEXT,
    distance REAL,
    position_x REAL,
    position_y REAL,
    position_z REAL,
    adm_file TEXT,
    line_number INTEGER,
    occurred_at TEXT,
    raw_line TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS server_stats (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL UNIQUE,
    total_kills INTEGER DEFAULT 0,
    total_deaths INTEGER DEFAULT 0,
    total_joins INTEGER DEFAULT 0,
    total_disconnects INTEGER DEFAULT 0,
    unique_players INTEGER DEFAULT 0,
    last_event_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT,
    trigger_type TEXT,
    status TEXT,
    message TEXT,
    lines_read INTEGER DEFAULT 0,
    lines_processed INTEGER DEFAULT 0,
    events_created INTEGER DEFAULT 0,
    kills_created INTEGER DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_adm_sync_state_linked_server_id ON adm_sync_state(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_adm_raw_events_linked_server_id ON adm_raw_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_adm_raw_events_adm_file ON adm_raw_events(adm_file)",
  "CREATE INDEX IF NOT EXISTS idx_adm_raw_events_event_type ON adm_raw_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_linked_server_id ON player_profiles(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_player_name ON player_profiles(player_name)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_player_id ON player_profiles(player_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_events_linked_server_id ON player_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_events_event_type ON player_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_player_events_occurred_at ON player_events(occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_linked_server_id ON kill_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_killer_name ON kill_events(killer_name)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_victim_name ON kill_events(victim_name)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_occurred_at ON kill_events(occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_stats_linked_server_id ON server_stats(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_linked_server_id ON sync_runs(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_created_at ON sync_runs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status)",
];
