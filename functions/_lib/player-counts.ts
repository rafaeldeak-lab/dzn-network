import { requireDb } from "./db";
import {
  readPublicApiCache,
  writePublicApiCache,
} from "./public-api-cache";
import type { Env } from "./types";
import {
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  serverLifecycleInSql,
  serverLifecycleSqlExpression,
} from "../../lib/server-lifecycle";

const PUBLIC_PLAYER_COUNT_FRESHNESS_MS = 30 * 60 * 1000;

const PUBLIC_HOME_STATS_PLAYER_COUNT_SNAPSHOT_KEYS = [
  { key: "home-stats:preview", accessLevel: "preview" as const },
  { key: "home-stats:full", accessLevel: "full" as const },
] as const;
const PUBLIC_PLAYER_COUNT_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})`;

export const PUBLIC_PLAYER_COUNT_FRESHNESS_CUTOFF_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes')";

export const PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL = `(
  linked_servers.current_players IS NOT NULL
  AND lower(COALESCE(linked_servers.player_count_status, '')) = 'fresh'
  AND linked_servers.player_count_last_checked_at IS NOT NULL
  AND linked_servers.player_count_last_checked_at >= ${PUBLIC_PLAYER_COUNT_FRESHNESS_CUTOFF_SQL}
)`;

export const PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL = `(
  server_public_cache.current_player_count IS NOT NULL
  AND server_public_cache.last_status_update_at IS NOT NULL
  AND server_public_cache.last_status_update_at >= ${PUBLIC_PLAYER_COUNT_FRESHNESS_CUTOFF_SQL}
  AND lower(COALESCE(linked_servers.player_count_status, '')) != 'unavailable'
  AND (
    linked_servers.player_count_last_checked_at IS NULL
    OR server_public_cache.last_status_update_at >= linked_servers.player_count_last_checked_at
  )
)`;

export const PUBLIC_CURRENT_PLAYERS_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} THEN linked_servers.current_players
  WHEN ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN server_public_cache.current_player_count
  ELSE NULL
END`;

export const PUBLIC_MAX_PLAYERS_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} THEN COALESCE(linked_servers.max_players, linked_servers.player_slots)
  WHEN ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN COALESCE(server_public_cache.max_player_count, linked_servers.max_players, linked_servers.player_slots)
  ELSE NULL
END`;

export const PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} THEN linked_servers.player_count_last_checked_at
  WHEN ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN server_public_cache.last_status_update_at
  ELSE COALESCE(linked_servers.player_count_last_checked_at, server_public_cache.last_status_update_at)
END`;

export const PUBLIC_PLAYER_COUNT_STATUS_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} OR ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN 'fresh'
  WHEN lower(COALESCE(linked_servers.player_count_status, '')) = 'unavailable' THEN 'unavailable'
  ELSE 'stale'
END`;

export const PUBLIC_PLAYER_COUNT_FRESH_SQL = `(${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} OR ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL})`;

export type PublicPlayerCountSourceRow = {
  serverId?: string | null;
  serverName?: string | null;
  serviceId?: string | null;
  linkedCurrentPlayers?: number | null;
  linkedMaxPlayers?: number | null;
  linkedCheckedAt?: string | null;
  linkedStatus?: string | null;
  cacheCurrentPlayers?: number | null;
  cacheMaxPlayers?: number | null;
  cacheCheckedAt?: string | null;
};

export function resolveFreshPublicPlayerCount(row: PublicPlayerCountSourceRow, nowMs = Date.now()) {
  const linkedCurrent = finiteNumber(row.linkedCurrentPlayers);
  const linkedFresh = linkedCurrent !== null
    && String(row.linkedStatus ?? "").toLowerCase() === "fresh"
    && isFreshTimestamp(row.linkedCheckedAt, nowMs);
  if (linkedFresh) {
    return {
      currentPlayers: linkedCurrent,
      maxPlayers: finiteNumber(row.linkedMaxPlayers),
      checkedAt: row.linkedCheckedAt ?? null,
      status: "fresh" as const,
      source: "linked_servers" as const,
    };
  }

  const cacheCurrent = finiteNumber(row.cacheCurrentPlayers);
  const linkedStatus = String(row.linkedStatus ?? "").toLowerCase();
  const linkedCheckedAt = timestampMs(row.linkedCheckedAt);
  const cacheCheckedAt = timestampMs(row.cacheCheckedAt);
  const cacheNotOlderThanLatestAttempt = linkedCheckedAt === null || (cacheCheckedAt !== null && cacheCheckedAt >= linkedCheckedAt);
  const cacheFresh = cacheCurrent !== null
    && linkedStatus !== "unavailable"
    && cacheNotOlderThanLatestAttempt
    && isFreshTimestamp(row.cacheCheckedAt, nowMs);
  if (cacheFresh) {
    return {
      currentPlayers: cacheCurrent,
      maxPlayers: finiteNumber(row.cacheMaxPlayers) ?? finiteNumber(row.linkedMaxPlayers),
      checkedAt: row.cacheCheckedAt ?? null,
      status: "fresh" as const,
      source: "server_public_cache" as const,
    };
  }

  return {
    currentPlayers: null,
    maxPlayers: null,
    checkedAt: row.linkedCheckedAt ?? row.cacheCheckedAt ?? null,
    status: linkedStatus === "unavailable" ? "unavailable" as const : "stale" as const,
    source: "none" as const,
  };
}

export function sumFreshPublicPlayers(rows: PublicPlayerCountSourceRow[], nowMs = Date.now()) {
  return rows.reduce((total, row) => total + (resolveFreshPublicPlayerCount(row, nowMs).currentPlayers ?? 0), 0);
}

export type PublicPlayerCountSummary = {
  totalPlayersOnline: number;
  maxPlayersCapacity: number;
  freshServers: number;
  staleServers: number;
  newestPlayerMetadataAt: string | null;
  oldestIncludedPlayerMetadataAt: string | null;
  contributingServers: Array<{
    serverId: string | null;
    serverName: string | null;
    serviceId: string | null;
    currentPlayers: number;
    maxPlayers: number | null;
    checkedAt: string | null;
    source: "linked_servers" | "server_public_cache";
  }>;
  excludedStaleServers: Array<{
    serverId: string | null;
    serverName: string | null;
    serviceId: string | null;
    checkedAt: string | null;
  }>;
};

type PublicPlayerCountDbRow = {
  server_id: string | null;
  server_name: string | null;
  service_id: string | null;
  current_players: number | null;
  max_players: number | null;
  checked_at: string | null;
  player_count_status: "fresh" | "stale" | "unavailable" | null;
  linked_current_players: number | null;
  linked_max_players: number | null;
  linked_checked_at: string | null;
  linked_status: string | null;
  cache_current_players: number | null;
  cache_max_players: number | null;
  cache_checked_at: string | null;
};

export async function getPublicPlayerCountSummary(db: D1Database, nowMs = Date.now()): Promise<PublicPlayerCountSummary> {
  const rows = await db
    .prepare(
      `SELECT
         linked_servers.id AS server_id,
         COALESCE(linked_servers.display_name, linked_servers.server_name, linked_servers.hostname, server_public_cache.public_server_name) AS server_name,
         linked_servers.nitrado_service_id AS service_id,
         ${PUBLIC_CURRENT_PLAYERS_SQL} AS current_players,
         ${PUBLIC_MAX_PLAYERS_SQL} AS max_players,
         ${PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL} AS checked_at,
         ${PUBLIC_PLAYER_COUNT_STATUS_SQL} AS player_count_status,
         linked_servers.current_players AS linked_current_players,
         COALESCE(linked_servers.max_players, linked_servers.player_slots) AS linked_max_players,
         linked_servers.player_count_last_checked_at AS linked_checked_at,
         linked_servers.player_count_status AS linked_status,
         server_public_cache.current_player_count AS cache_current_players,
         server_public_cache.max_player_count AS cache_max_players,
         server_public_cache.last_status_update_at AS cache_checked_at
       FROM linked_servers
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_PLAYER_COUNT_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .all<PublicPlayerCountDbRow>()
    .then((result) => result.results ?? []);

  const contributingServers: PublicPlayerCountSummary["contributingServers"] = [];
  const excludedStaleServers: PublicPlayerCountSummary["excludedStaleServers"] = [];
  let totalPlayersOnline = 0;
  let maxPlayersCapacity = 0;
  let newestPlayerMetadataAt: string | null = null;
  let oldestIncludedPlayerMetadataAt: string | null = null;

  for (const row of rows) {
    const resolved = resolveFreshPublicPlayerCount({
      serverId: row.server_id,
      serverName: row.server_name,
      serviceId: row.service_id,
      linkedCurrentPlayers: row.linked_current_players,
      linkedMaxPlayers: row.linked_max_players,
      linkedCheckedAt: row.linked_checked_at,
      linkedStatus: row.linked_status,
      cacheCurrentPlayers: row.cache_current_players,
      cacheMaxPlayers: row.cache_max_players,
      cacheCheckedAt: row.cache_checked_at,
    }, nowMs);

    if (resolved.currentPlayers === null) {
      excludedStaleServers.push({
        serverId: row.server_id,
        serverName: row.server_name,
        serviceId: row.service_id,
        checkedAt: row.checked_at,
      });
      continue;
    }

    totalPlayersOnline += resolved.currentPlayers;
    maxPlayersCapacity += resolved.maxPlayers ?? 0;
    newestPlayerMetadataAt = newestIso(newestPlayerMetadataAt, resolved.checkedAt);
    oldestIncludedPlayerMetadataAt = oldestIso(oldestIncludedPlayerMetadataAt, resolved.checkedAt);
    contributingServers.push({
      serverId: row.server_id,
      serverName: row.server_name,
      serviceId: row.service_id,
      currentPlayers: resolved.currentPlayers,
      maxPlayers: resolved.maxPlayers,
      checkedAt: resolved.checkedAt,
      source: resolved.source,
    });
  }

  return {
    totalPlayersOnline,
    maxPlayersCapacity,
    freshServers: contributingServers.length,
    staleServers: excludedStaleServers.length,
    newestPlayerMetadataAt,
    oldestIncludedPlayerMetadataAt,
    contributingServers,
    excludedStaleServers,
  };
}

export function applyPublicPlayerCountSummaryToHomeStats<T extends {
  totals?: Record<string, unknown> | null;
  playersOnline?: unknown;
  currentPlayersOnline?: unknown;
  playerCountSummary?: unknown;
}>(payload: T, summary: PublicPlayerCountSummary): T {
  return {
    ...payload,
    totals: {
      ...(payload.totals ?? {}),
      players_online: summary.totalPlayersOnline,
      currentPlayersOnline: summary.totalPlayersOnline,
      maxPlayersCapacity: summary.maxPlayersCapacity,
      playerCountFreshServers: summary.freshServers,
      playerCountStaleServers: summary.staleServers,
      playerCountNewestCheckedAt: summary.newestPlayerMetadataAt,
      playerCountOldestIncludedCheckedAt: summary.oldestIncludedPlayerMetadataAt,
    },
    playersOnline: summary.totalPlayersOnline,
    currentPlayersOnline: summary.totalPlayersOnline,
    playerCountSummary: publicPlayerCountSummaryForApi(summary),
  };
}

export async function patchHomeStatsPlayerCountsFromFreshMetadata(env: Env) {
  if (!env.DB) return { patched: 0, skipped: PUBLIC_HOME_STATS_PLAYER_COUNT_SNAPSHOT_KEYS.length };
  const db = requireDb(env);
  const summary = await getPublicPlayerCountSummary(db);
  let patched = 0;
  let skipped = 0;
  const generatedAt = new Date().toISOString();

  for (const snapshot of PUBLIC_HOME_STATS_PLAYER_COUNT_SNAPSHOT_KEYS) {
    const cached = await readPublicApiCache<Record<string, unknown>>(env, snapshot.key).catch(() => null);
    if (!cached?.payload) {
      skipped += 1;
      continue;
    }
    await writePublicApiCache(env, snapshot.key, applyPublicPlayerCountSummaryToHomeStats(cached.payload, summary), generatedAt, snapshot.accessLevel);
    patched += 1;
  }

  return { patched, skipped };
}

export function publicPlayerCountSummaryForApi(summary: PublicPlayerCountSummary) {
  return {
    totalPlayersOnline: summary.totalPlayersOnline,
    maxPlayersCapacity: summary.maxPlayersCapacity,
    freshServers: summary.freshServers,
    staleServers: summary.staleServers,
    newestPlayerMetadataAt: summary.newestPlayerMetadataAt,
    oldestIncludedPlayerMetadataAt: summary.oldestIncludedPlayerMetadataAt,
    contributingServers: summary.contributingServers.map((server) => ({
      serverName: server.serverName,
      currentPlayers: server.currentPlayers,
      maxPlayers: server.maxPlayers,
      checkedAt: server.checkedAt,
      source: server.source,
    })),
    excludedStaleServers: summary.excludedStaleServers.map((server) => ({
      serverName: server.serverName,
      checkedAt: server.checkedAt,
    })),
  };
}

function isFreshTimestamp(value: string | null | undefined, nowMs: number) {
  const time = timestampMs(value);
  return time !== null && nowMs - time <= PUBLIC_PLAYER_COUNT_FRESHNESS_MS;
}

function timestampMs(value: string | null | undefined) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newestIso(left: string | null, right: string | null) {
  if (!right) return left;
  if (!left) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function oldestIso(left: string | null, right: string | null) {
  if (!right) return left;
  if (!left) return right;
  return Date.parse(right) < Date.parse(left) ? right : left;
}
