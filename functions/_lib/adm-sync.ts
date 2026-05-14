import { parseAdmLines, type ParsedAdmEvent } from "./adm-parser";
import { getCurrentLinkedServer, requireDb, saveServerAdmPath } from "./db";
import { isMockNitrado } from "./mock";
import { detectNitradoAdmLogs, getAdmLogStoragePath, mockAdmLogDetection, testExactNitradoAdmPath } from "./nitrado";
import { getLatestNitradoToken } from "./onboarding";
import type { Env } from "./types";

type SyncLinkedServer = {
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
};

export type AdmSyncResult = {
  status: string;
  message: string;
  linesSeen: number;
  linesProcessed: number;
  eventsCreated: number;
  killsCreated: number;
  latestAdmFile: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
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
};

export async function runAdmSync(env: Env, userId: string, linkedServerId?: string | null): Promise<AdmSyncResult> {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");
  if (!linkedServer.nitrado_service_id) throw new Error("No Nitrado service selected");

  const existingState = await getSyncState(env, linkedServer.id);
  const isMock = isMockNitrado(env.MOCK_NITRADO);
  const now = new Date().toISOString();
  const admLog = isMock
    ? mockAdmLogDetection()
    : linkedServer.adm_path
      ? await testExactNitradoAdmPath((await getLatestNitradoToken(env, userId)) ?? "", linkedServer.nitrado_service_id, linkedServer.adm_path)
      : await detectNitradoAdmLogs((await getLatestNitradoToken(env, userId)) ?? "", linkedServer.nitrado_service_id);

  const latestAdmPath = getAdmLogStoragePath(admLog) ?? linkedServer.adm_path ?? null;
  const latestAdmFile = admLog.newestAdmFileName ?? fileNameFromPath(latestAdmPath);
  if (admLog.admFileExists && latestAdmPath) {
    await saveServerAdmPath(env, linkedServer.id, latestAdmPath.replace(/^\/+/, ""));
  }

  const lines = isMock ? mockAdmLines() : getReadableAdmLines(admLog.debug?.samplePreview ?? null);
  if (!lines.length) {
    const message = admLog.admFileExists
      ? "ADM file discovered but not readable through Nitrado file API yet"
      : "No ADM file is available for sync yet";
    await upsertSyncState(env, linkedServer.id, {
      latestAdmFile,
      latestAdmPath,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status: admLog.admFileExists ? "read_pending" : "not_started",
      message,
      lastSyncAt: now,
    });
    return {
      status: admLog.admFileExists ? "read_pending" : "not_started",
      message,
      linesSeen: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      latestAdmFile,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastSyncAt: now,
    };
  }

  const isSameAdmFile = Boolean(latestAdmFile && existingState?.last_processed_file === latestAdmFile);
  const lastProcessedLine = isSameAdmFile ? Number(existingState?.last_processed_line ?? 0) : 0;
  const parsedLines = parseAdmLines(lines, { admDate: extractAdmDateFromFile(latestAdmFile) ?? undefined });
  const pendingParsedEvents = parsedLines.slice(lastProcessedLine);
  let eventsCreated = 0;
  let killsCreated = 0;
  let joinsCreated = 0;
  let disconnectsCreated = 0;
  let deathsCreated = 0;
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

  for (let index = 0; index < pendingParsedEvents.length; index += 1) {
    const parsed = pendingParsedEvents[index];
    const rawLine = parsed.rawLine;
    const lineNumber = lastProcessedLine + index + 1;
    await insertRawEvent(env, linkedServer.id, latestAdmFile, lineNumber, rawLine, parsed);
    processedOffset += rawLine.length + 1;

    const eventResult = await persistParsedEvent(env, linkedServer.id, latestAdmFile, lineNumber, parsed, {
      recentDeathLines,
    });
    eventsCreated += eventResult.eventsCreated;
    killsCreated += eventResult.killsCreated;
    joinsCreated += eventResult.joinsCreated;
    disconnectsCreated += eventResult.disconnectsCreated;
    deathsCreated += eventResult.deathsCreated;
    lastEventAt = parsed.occurredAt ?? now;
  }

  const nextProcessedLine = lastProcessedLine + pendingParsedEvents.length;
  const status = pendingParsedEvents.length ? "completed" : "idle";
  const message = pendingParsedEvents.length ? "Manual ADM sync completed" : "No new ADM lines to process";
  const uniquePlayers = await countUniquePlayers(env, linkedServer.id);
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
  });

  return {
    status,
    message,
    linesSeen: lines.length,
    linesProcessed: pendingParsedEvents.length,
    eventsCreated,
    killsCreated,
    latestAdmFile,
    lastProcessedLine: nextProcessedLine,
    lastSyncAt: now,
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
      `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at
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
           COALESCE(occurred_at, created_at) AS sort_time
         FROM kill_events
         WHERE linked_server_id = ?

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
           COALESCE(occurred_at, created_at) AS sort_time
         FROM player_events
         WHERE linked_server_id = ?
       )
       ORDER BY sort_time DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(linkedServer.id, linkedServer.id, safeLimit)
    .all<AdmRecentSyncEvent>();

  return result.results ?? [];
}

export async function ensureAdmSyncSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of ADM_SYNC_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
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
  },
) {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO adm_sync_state (
        id, linked_server_id, latest_adm_file, latest_adm_path, last_processed_file,
        last_processed_line, last_processed_offset, last_sync_status, last_sync_message,
        last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        latest_adm_file = excluded.latest_adm_file,
        latest_adm_path = excluded.latest_adm_path,
        last_processed_file = excluded.last_processed_file,
        last_processed_line = excluded.last_processed_line,
        last_processed_offset = excluded.last_processed_offset,
        last_sync_status = excluded.last_sync_status,
        last_sync_message = excluded.last_sync_message,
        last_sync_at = excluded.last_sync_at,
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
  await db
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

function getReadableAdmLines(samplePreview: string | null) {
  if (!samplePreview) return [];
  return samplePreview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
    (parsed.eventType === "player_killed" && parsed.isCreditedKill) ||
    parsed.eventType === "player_killed_environment" ||
    parsed.eventType === "player_suicide" ||
    parsed.eventType === "player_died_stats"
  );
}

function emptyPersistResult() {
  return {
    eventsCreated: 0,
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
];
