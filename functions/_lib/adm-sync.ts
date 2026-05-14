import { parseAdmLine, type ParsedAdmEvent } from "./adm-parser";
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

  const lastProcessedLine = existingState?.last_processed_file === latestAdmFile
    ? Number(existingState?.last_processed_line ?? 0)
    : 0;
  const pendingLines = lines.slice(lastProcessedLine);
  let eventsCreated = 0;
  let killsCreated = 0;
  let joinsCreated = 0;
  let disconnectsCreated = 0;
  let deathsCreated = 0;
  let processedOffset = Number(existingState?.last_processed_offset ?? 0);
  let lastEventAt: string | null = null;

  for (let index = 0; index < pendingLines.length; index += 1) {
    const rawLine = pendingLines[index];
    const lineNumber = lastProcessedLine + index + 1;
    const parsed = parseAdmLine(rawLine);
    await insertRawEvent(env, linkedServer.id, latestAdmFile, lineNumber, rawLine, parsed);
    processedOffset += rawLine.length + 1;

    const eventResult = await persistParsedEvent(env, linkedServer.id, latestAdmFile, lineNumber, parsed);
    eventsCreated += eventResult.eventsCreated;
    killsCreated += eventResult.killsCreated;
    joinsCreated += eventResult.joinsCreated;
    disconnectsCreated += eventResult.disconnectsCreated;
    deathsCreated += eventResult.deathsCreated;
    lastEventAt = parsed.occurredAt ?? now;
  }

  const nextProcessedLine = lastProcessedLine + pendingLines.length;
  const status = pendingLines.length ? "completed" : "idle";
  const message = pendingLines.length ? "Manual ADM sync completed" : "No new ADM lines to process";
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
    linesProcessed: pendingLines.length,
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
  await db
    .prepare(
      `INSERT INTO adm_raw_events (
        id, linked_server_id, adm_file, line_number, raw_line, event_type, parsed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      crypto.randomUUID(),
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
) {
  if (parsed.eventType === "admin_log_started" || parsed.eventType === "unknown") {
    return emptyPersistResult();
  }

  let playerProfileId: string | null = null;
  if (parsed.playerName) {
    playerProfileId = await upsertPlayerProfile(env, linkedServerId, parsed.playerName, parsed.playerId, parsed.occurredAt);
  }

  await insertPlayerEvent(env, linkedServerId, playerProfileId, admFile, lineNumber, parsed);
  const result = emptyPersistResult();
  result.eventsCreated = 1;
  if (parsed.eventType === "player_connected") result.joinsCreated = 1;
  if (parsed.eventType === "player_disconnected") result.disconnectsCreated = 1;

  if (parsed.eventType === "player_killed" || parsed.eventType === "player_suicide" || parsed.eventType === "player_died") {
    const victimProfileId = parsed.victimName
      ? await upsertPlayerProfile(env, linkedServerId, parsed.victimName, parsed.victimId, parsed.occurredAt)
      : playerProfileId;
    const killerProfileId = parsed.eventType === "player_killed" ? playerProfileId : null;
    await insertKillEvent(env, linkedServerId, killerProfileId, victimProfileId, admFile, lineNumber, parsed);
    await updateProfilesForDeath(env, killerProfileId, victimProfileId, parsed);
    result.killsCreated = parsed.eventType === "player_killed" ? 1 : 0;
    result.deathsCreated = 1;
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
  await db
    .prepare(
      `INSERT INTO player_events (
        id, linked_server_id, player_profile_id, player_name, player_id, event_type,
        position_x, position_y, position_z, adm_file, line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      crypto.randomUUID(),
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
  await db
    .prepare(
      `INSERT INTO kill_events (
        id, linked_server_id, killer_profile_id, victim_profile_id, killer_name, victim_name,
        killer_id, victim_id, weapon, distance, position_x, position_y, position_z,
        adm_file, line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      killerProfileId,
      victimProfileId,
      parsed.playerName,
      parsed.victimName,
      parsed.playerId,
      parsed.victimId,
      parsed.weapon,
      parsed.distance,
      parsed.position?.x ?? null,
      parsed.position?.y ?? null,
      parsed.position?.z ?? null,
      admFile,
      lineNumber,
      parsed.occurredAt,
      parsed.rawLine,
    )
    .run();
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
  killerProfileId: string | null,
  victimProfileId: string | null,
  parsed: ParsedAdmEvent,
) {
  const db = requireDb(env);
  if (killerProfileId) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          kills = kills + 1,
          longest_kill_distance = MAX(longest_kill_distance, ?),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(parsed.distance ?? 0, killerProfileId)
      .run();
  }
  if (victimProfileId) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          deaths = deaths + 1,
          suicides = suicides + ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(parsed.eventType === "player_suicide" ? 1 : 0, victimProfileId)
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
    "AdminLog started",
    "Player \"MockSurvivor\" (id=mock-player-1 pos=<123.4, 0.0, 456.7>) is connected",
    "Player \"MockSurvivor\" (id=mock-player-1 pos=<124.0, 0.0, 457.0>) placed Fireplace",
    "Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 0.0, 490.0>) killed Player \"MockSurvivor\" (id=mock-player-1) with M4A1 from 72.5 meters",
    "Player \"MockBandit\" (id=mock-player-2) has been disconnected",
  ];
}

function fileNameFromPath(path: string | null) {
  return path ? path.split("/").filter(Boolean).at(-1) ?? null : null;
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
