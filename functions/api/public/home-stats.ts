import { ensureAdmSyncSchema } from "../../_lib/adm-sync";
import { ensureBuildEventSchema, getRankedBuildServers } from "../../_lib/build-events";
import type { PublicBuildLeaderboardRow } from "../../_lib/build-events";
import { ensureLinkedServerMetadataColumns, requireDb } from "../../_lib/db";
import { locationLabel as formatLocationLabel } from "../../_lib/geoip";
import { json, methodNotAllowed } from "../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders } from "../../_lib/public-auth";
import {
  applyPublicPlayerCountSummaryToHomeStats,
  getPublicPlayerCountSummary,
  PUBLIC_CURRENT_PLAYERS_SQL,
  PUBLIC_MAX_PLAYERS_SQL,
  PUBLIC_PLAYER_COUNT_FRESH_SQL,
} from "../../_lib/player-counts";
import {
  logPublicApi503RootCause,
  logPublicApiLoadFailed,
  logPublicApiSnapshotFallbackServed,
  publicApiSnapshotAccess,
  readPublicApiCache,
  safePublicCacheError,
  withPublicApiMetadata,
  writePublicApiCache,
} from "../../_lib/public-api-cache";
import { getRankedPublicServers } from "../../_lib/public-leaderboards";
import {
  applyPublicAdmStatsSummaryToHomeStats,
  getPublicAdmStatsSummary,
} from "../../_lib/server-stats";
import type { Env, PagesFunction } from "../../_lib/types";
import {
  SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES,
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  serverLifecycleInSql,
  serverLifecycleSqlExpression,
} from "../../../lib/server-lifecycle";

const PUBLIC_LINKED_SERVER_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})`;
const PUBLIC_HISTORICAL_LINKED_SERVER_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES)})`;
const PUBLIC_HISTORICAL_BUILD_SERVER_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("build_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES)})`;
const PUBLIC_LIVE_KILL_SERVER_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("live_kill_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})`;
const PUBLIC_LIVE_DEATH_SERVER_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("live_death_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})`;
const PUBLIC_LIVE_LONGEST_SERVER_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("live_longest_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})`;

type TotalsRow = {
  serversLinked: number | null;
  statsActiveServers: number | null;
  players_online: number | null;
  currentPlayersOnline: number | null;
  maxPlayersCapacity: number | null;
  playerCountFreshServers: number | null;
  playerCountStaleServers: number | null;
  playersSeenFromStats: number | null;
  killsTracked: number | null;
  deathsTracked: number | null;
  joinsTracked: number | null;
  longestKill: number | null;
  totalEventsTracked?: number | null;
  recentEventsCount?: number | null;
  structuresBuilt: number | null;
  buildScore: number | null;
};

type GameModeRow = {
  server_type: string | null;
  count: number | null;
};

type TopPlayerRow = {
  player_name: string;
  server_name: string;
  public_slug: string | null;
  kills: number | null;
  deaths: number | null;
  longest_kill_distance: number | null;
};

type RecentActivityRow = {
  source: "kill" | "player" | "build" | "sync" | "server";
  event_type: string;
  server_name: string | null;
  public_slug: string | null;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  build_part?: string | null;
  target_object?: string | null;
  placed_object?: string | null;
  placed_class?: string | null;
  occurred_at: string | null;
  created_at: string | null;
};

type BuildBreakdownRow = {
  linked_server_id: string;
  full_walls_built: number | null;
  watchtowers_built: number | null;
  gates_fence_kits_built: number | null;
  storage_expansion_built: number | null;
};

type BuildLeaderboardRow = PublicBuildLeaderboardRow & {
  full_walls_built: number;
  watchtowers_built: number;
  gates_fence_kits_built: number;
  storage_expansion_built: number;
};

type PreviewTopServerRow = {
  public_slug: string | null;
  server_name: string | null;
  server_type: string | null;
  total_kills: number | null;
  total_deaths: number | null;
  unique_players: number | null;
  total_joins: number | null;
  longest_kill: number | null;
  stats_active: number | null;
  updated_at: string | null;
};

type HomeStatsSectionReason = "login_required" | "plan_required" | null;

type HomeStatsSectionAccess = {
  locked: boolean;
  reason: HomeStatsSectionReason;
};

type HomeStatsSections = {
  topServers: HomeStatsSectionAccess;
  recentActivity: HomeStatsSectionAccess;
  liveGlobeTracker: HomeStatsSectionAccess;
};

export type MapNodeRow = {
  id: string;
  status?: string | null;
  merged_into_server_id?: string | null;
  public_slug: string | null;
  server_name: string | null;
  guild_name: string | null;
  server_type: string | null;
  region: string | null;
  platform: string | null;
  map_name: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  geo_timezone: string | null;
  geo_source: string | null;
  stats_active: number | null;
};

const MOCK_PLAYER_PREFIXES = ["MockSurvivor", "MockBandit", "MockRunner"];
const HOME_STATS_SNAPSHOT_KEYS = {
  preview: "home-stats:preview",
  full: "home-stats:full",
} as const;
const HOME_STATS_NO_STORE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache",
  expires: "0",
  vary: "Cookie",
};
const HOME_STATS_PUBLIC_FAST_PATH_MAX_AGE_MS = 2 * 60 * 1000;
const HOME_STATS_AUTH_FAST_PATH_MAX_AGE_MS = 5 * 60 * 1000;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  const headers = homeStatsResponseHeaders(viewerLoggedIn);
  const accessLevel = publicApiSnapshotAccess(viewerLoggedIn);
  const cacheKey = homeStatsCacheKey(viewerLoggedIn);
  const endpoint = "/api/public/home-stats";
  const requestId = request.headers.get("cf-ray");

  try {
    const cached = await readPublicApiCache<ReturnType<typeof emptyHomeStats>>(env, cacheKey).catch(() => null);
    if (cached && isFreshHomeStatsSnapshot(cached.generated_at, viewerLoggedIn)) {
      const payloadWithFreshCounters = await refreshHomeStatsLiveCounters(env, cached.payload).catch(() => cached.payload);
      const payload = withHomeStatsEvidence(payloadWithFreshCounters, {
        generatedAt: cached.generated_at,
        source: "last_known",
        statusMessage: "Updated from cached public ADM snapshot",
      });
      return json(withPublicApiMetadata(payload, {
        generated_at: cached.generated_at,
        source: "last_known",
        stale: false,
        snapshot_generated_at: cached.generated_at,
        message: "Updated from cached public ADM snapshot.",
      }), { headers });
    }

    const generatedAt = new Date().toISOString();
    const livePayload = await getPublicHomeStatsPayload(env, viewerLoggedIn);
    const payloadWithFreshPlayerCounts = await refreshHomeStatsLiveCounters(env, livePayload).catch(() => livePayload);
    const data = withHomeStatsEvidence(payloadWithFreshPlayerCounts, {
      generatedAt,
      source: "live",
    });
    await writePublicApiCache(env, cacheKey, data, generatedAt, accessLevel).catch((error) => {
      console.warn("DZN HOME STATS CACHE WRITE FAILED", safeErrorMessage(error));
    });
    return json(withPublicApiMetadata(data, {
      generated_at: generatedAt,
      source: "live",
      stale: false,
    }), { headers });
  } catch (error) {
    logPublicApiLoadFailed(endpoint, 503, error, requestId);
    const cached = await readPublicApiCache<ReturnType<typeof emptyHomeStats>>(env, cacheKey).catch(() => null);
    if (cached) {
      logPublicApiSnapshotFallbackServed(endpoint, cacheKey, requestId);
      const payloadWithFreshPlayerCounts = await refreshHomeStatsLiveCounters(env, cached.payload).catch(() => cached.payload);
      const payload = withHomeStatsEvidence(payloadWithFreshPlayerCounts, {
        generatedAt: cached.generated_at,
        source: "last_known",
        statusMessage: "Updated from last synced ADM",
      });
      return json(withPublicApiMetadata(payload, {
        generated_at: cached.generated_at,
        source: "last_known",
        stale: true,
        fallback_reason: "live_query_failed_using_snapshot",
        snapshot_generated_at: cached.generated_at,
        message: "Updated from last synced ADM while live refresh recovers.",
      }), { headers });
    }
    const fallback = await buildLastKnownHomeStatsFallback(env, viewerLoggedIn).catch(() => null);
    if (fallback?.hasAdmData || fallback?.everSyncedAdm) {
      return json(withPublicApiMetadata(fallback, {
        generated_at: fallback.generated_at ?? new Date().toISOString(),
        source: "last_known",
        stale: true,
        fallback_reason: "live_query_failed_using_db_last_known",
        message: "Updated from last synced ADM while live refresh recovers.",
      }), { headers });
    }
    logPublicApi503RootCause(endpoint, error, requestId, "home_stats_live_query");
    const generatedAt = new Date().toISOString();
    const empty = withHomeStatsEvidence(emptyHomeStats(), {
      generatedAt,
      source: "fallback_empty",
      statusMessage: "Waiting for first ADM sync",
    });
    return json(withPublicApiMetadata({
      ...empty,
      error: safePublicCacheError(error),
      error_code: "live_query_failed_no_snapshot",
      retry_after_seconds: 10,
    }, {
      generated_at: generatedAt,
      source: "fallback_empty",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
      message: "Waiting for first ADM sync.",
    }), { headers });
  }
};

function homeStatsCacheKey(viewerLoggedIn: boolean) {
  return viewerLoggedIn ? HOME_STATS_SNAPSHOT_KEYS.full : HOME_STATS_SNAPSHOT_KEYS.preview;
}

function homeStatsResponseHeaders(viewerLoggedIn: boolean) {
  return viewerLoggedIn
    ? {
        ...publicAccessCacheHeaders(viewerLoggedIn),
        ...HOME_STATS_NO_STORE_HEADERS,
      }
    : publicAccessCacheHeaders(viewerLoggedIn);
}

function isFreshPublicHomeStatsSnapshot(generatedAt: string | null | undefined) {
  return isFreshHomeStatsSnapshot(generatedAt, false);
}

function isFreshHomeStatsSnapshot(generatedAt: string | null | undefined, viewerLoggedIn: boolean) {
  const timestamp = Date.parse(generatedAt ?? "");
  const maxAgeMs = viewerLoggedIn ? HOME_STATS_AUTH_FAST_PATH_MAX_AGE_MS : HOME_STATS_PUBLIC_FAST_PATH_MAX_AGE_MS;
  return Number.isFinite(timestamp) && Date.now() - timestamp <= maxAgeMs;
}

async function refreshHomeStatsLiveCounters<T extends {
  totals?: Record<string, unknown> | null;
  playersOnline?: unknown;
  currentPlayersOnline?: unknown;
  playerCountSummary?: unknown;
}>(env: Env, payload: T) {
  if (!env.DB) return payload;
  const db = requireDb(env);
  const [playerSummary, admSummary] = await Promise.all([
    getPublicPlayerCountSummary(db),
    getPublicAdmStatsSummary(db),
  ]);
  return applyPublicAdmStatsSummaryToHomeStats(applyPublicPlayerCountSummaryToHomeStats(payload, playerSummary), admSummary);
}

export async function getPublicHomeStatsPayload(env: Env, viewerLoggedIn: boolean) {
  if (!env.DB) throw new Error("Database binding is missing.");
  await ensureLinkedServerMetadataColumns(env);
  if (!viewerLoggedIn) {
    return applyHomeStatsAccess(await buildPreviewHomeStats(env), false);
  }
  await ensureAdmSyncSchema(env);
  await ensureBuildEventSchema(env);
  return applyHomeStatsAccess(await buildHomeStats(env), true);
}

async function buildLastKnownHomeStatsFallback(env: Env, viewerLoggedIn: boolean) {
  if (!env.DB) return null;
  const generatedAt = new Date().toISOString();
  const data = await buildPreviewHomeStats(env);
  return withHomeStatsEvidence(applyHomeStatsAccess(data, viewerLoggedIn), {
    generatedAt,
    source: "last_known",
    statusMessage: "Updated from last synced ADM",
  });
}

function withHomeStatsEvidence<T extends {
  totals?: Record<string, unknown>;
  network_pulse?: Record<string, unknown>;
  topServers?: unknown[];
  recentActivity?: unknown[];
  top_build_servers?: unknown[];
  event_leaderboard?: unknown;
  map_nodes?: unknown[];
  generated_at?: string | null;
  source?: string | null;
  hasAdmData?: boolean;
  everSyncedAdm?: boolean;
  lastSuccessfulAdmImportAt?: string | null;
  totalEventsTracked?: number | null;
  recentActivityCount?: number | null;
  buildLeaderboard?: unknown[];
  statusMessage?: string;
}>(data: T, options: {
  generatedAt: string;
  source: "live" | "last_known" | "fallback_empty";
  statusMessage?: string;
}) {
  const totals = data.totals ?? {};
  const topServers = Array.isArray(data.topServers) ? data.topServers : [];
  const recentActivity = Array.isArray(data.recentActivity) ? data.recentActivity : [];
  const mapNodes = Array.isArray(data.map_nodes) ? data.map_nodes : [];
  const topBuildServers = Array.isArray(data.top_build_servers) ? data.top_build_servers : [];
  const eventRows = data.event_leaderboard && typeof data.event_leaderboard === "object" && Array.isArray((data.event_leaderboard as { rows?: unknown[] }).rows)
    ? (data.event_leaderboard as { rows: unknown[] }).rows
    : [];
  const buildLeaderboard = Array.isArray(data.buildLeaderboard)
    ? data.buildLeaderboard
    : eventRows.length > 0
      ? eventRows
      : topBuildServers;
  const lastSuccessfulAdmImportAt = firstString(
    data.lastSuccessfulAdmImportAt,
    topServers.find((server) => Boolean((server as { updated_at?: unknown }).updated_at)) && (topServers.find((server) => Boolean((server as { updated_at?: unknown }).updated_at)) as { updated_at?: unknown }).updated_at,
  );
  const statsActiveServers = numberOrZero(totals.statsActiveServers);
  const killsTracked = numberOrZero(totals.killsTracked);
  const deathsTracked = numberOrZero(totals.deathsTracked);
  const joinsTracked = numberOrZero(totals.joinsTracked);
  const recentEventsCount = numberOrZero(totals.recentEventsCount);
  const totalEventsTracked = Math.max(
    numberOrZero(totals.totalEventsTracked),
    numberOrZero(data.totalEventsTracked),
    numberOrZero((data.network_pulse as { events?: unknown } | undefined)?.events),
    recentEventsCount,
  );
  const recentActivityCount = recentActivity.length;
  const hasAdmData = Boolean(data.hasAdmData)
    || statsActiveServers > 0
    || killsTracked > 0
    || deathsTracked > 0
    || joinsTracked > 0
    || totalEventsTracked > 0
    || recentEventsCount > 0
    || numberOrZero(totals.structuresBuilt) > 0
    || numberOrZero(totals.buildScore) > 0
    || topServers.length > 0
    || recentActivity.length > 0
    || buildLeaderboard.length > 0
    || mapNodes.some((node) => Boolean((node as { active?: unknown; sync_status?: unknown; status?: unknown }).active)
      || (node as { sync_status?: unknown }).sync_status === "active"
      || (node as { status?: unknown }).status === "active");
  const everSyncedAdm = Boolean(data.everSyncedAdm) || hasAdmData || Boolean(lastSuccessfulAdmImportAt);

  return {
    ...data,
    totals: {
      ...totals,
      totalEventsTracked,
      recentEventsCount,
    },
    network_pulse: data.network_pulse
      ? {
          ...data.network_pulse,
          events: totalEventsTracked,
        }
      : data.network_pulse,
    source: options.source,
    generated_at: options.generatedAt,
    generatedAt: options.generatedAt,
    lastSuccessfulAdmImportAt,
    hasAdmData,
    everSyncedAdm,
    statsActiveServers,
    playersOnline: numberOrZero(totals.players_online ?? totals.currentPlayersOnline),
    serversLinked: numberOrZero(totals.serversLinked),
    killsTracked,
    deathsTracked,
    joinsTracked,
    totalEventsTracked,
    recentEventsCount,
    recentActivityCount,
    mapNodes: mapNodes.length,
    buildLeaderboard,
    statusMessage: options.statusMessage ?? (options.source === "last_known"
      ? "Updated from last synced ADM"
      : hasAdmData
        ? "Live sync active"
        : "Waiting for first ADM sync"),
  };
}

async function buildPreviewHomeStats(env: Env) {
  const db = requireDb(env);
  const [totals, topServers, gameModes, mapNodes, lastSuccessfulAdmImportAt, admSummary] = await Promise.all([
    getPreviewTotals(db),
    getPreviewTopServers(db),
    getGameModes(db).catch(() => ({ pvp: 0, pve: 0, deathmatch: 0, pvpPve: 0 })),
    getPreviewMapNodes(db),
    getLastSuccessfulAdmImportAt(db),
    getPublicAdmStatsSummary(db),
  ]);
  const totalEventsTracked = await getMonotonicNetworkEventTotal(env, admSummary.totalEventsTracked);
  const syncActive = numberOrZero(totals.statsActiveServers);
  const serversLinked = numberOrZero(totals.serversLinked);
  const recentActivity = buildPreviewRecentActivity(topServers);
  const recentEventsCount = recentActivity.length;
  const data = emptyHomeStats();
  return {
    ...data,
    source: "last_known_adm_preview",
    generated_at: new Date().toISOString(),
    lastSuccessfulAdmImportAt,
    totals: {
      ...data.totals,
      serversLinked,
      statsActiveServers: syncActive,
      players_online: numberOrZero(totals.players_online ?? totals.currentPlayersOnline),
      currentPlayersOnline: numberOrZero(totals.players_online ?? totals.currentPlayersOnline),
      maxPlayersCapacity: numberOrZero(totals.maxPlayersCapacity),
      playerCountFreshServers: numberOrZero(totals.playerCountFreshServers),
      playerCountStaleServers: numberOrZero(totals.playerCountStaleServers),
      killsTracked: admSummary.killsTracked,
      deathsTracked: admSummary.deathsTracked,
      joinsTracked: admSummary.joinsTracked,
      longestKill: admSummary.longestKill,
      totalEventsTracked,
      recentEventsCount,
      structuresBuilt: numberOrZero(totals.structuresBuilt),
      buildScore: numberOrZero(totals.buildScore),
    },
    network_pulse: {
      ...data.network_pulse,
      active_servers: syncActive,
      events: totalEventsTracked,
      top_server: topServers[0] ?? null,
    },
    topServers,
    recentActivity,
    map_nodes: mapNodes,
    gameModes,
    syncHealth: {
      active: syncActive,
      pending: Math.max(serversLinked - syncActive, 0),
    },
  };
}

async function getPreviewTotals(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
        COUNT(linked_servers.id) AS serversLinked,
        SUM(COALESCE(${PUBLIC_CURRENT_PLAYERS_SQL}, 0)) AS players_online,
        SUM(COALESCE(${PUBLIC_CURRENT_PLAYERS_SQL}, 0)) AS currentPlayersOnline,
        SUM(COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, 0)) AS maxPlayersCapacity,
        SUM(CASE WHEN ${PUBLIC_PLAYER_COUNT_FRESH_SQL} THEN 1 ELSE 0 END) AS playerCountFreshServers,
        SUM(CASE WHEN ${PUBLIC_PLAYER_COUNT_FRESH_SQL} THEN 0 ELSE 1 END) AS playerCountStaleServers,
        SUM(
          CASE
            WHEN COALESCE(server_stats.total_joins, 0) > 0
              OR COALESCE(server_stats.total_disconnects, 0) > 0
              OR COALESCE(server_stats.total_deaths, 0) > 0
              OR COALESCE(server_stats.total_kills, 0) > 0
              OR COALESCE(server_stats.unique_players, 0) > 0
              OR COALESCE(server_public_cache.last_adm_update_at, '') <> ''
              OR COALESCE(adm_sync_state.last_processed_file, '') <> ''
              OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'completed_with_warnings', 'adm_backfill_caught_up', 'caught_up_waiting_for_growth', 'processed', 'completed_empty', 'completed_closed')
            THEN 1 ELSE 0
          END
        ) AS statsActiveServers,
        SUM(COALESCE(server_stats.unique_players, 0)) AS playersSeenFromStats,
        SUM(COALESCE(server_stats.total_kills, 0)) AS killsTracked,
        SUM(COALESCE(server_stats.total_deaths, 0)) AS deathsTracked,
        SUM(COALESCE(server_stats.total_joins, 0)) AS joinsTracked,
        0 AS longestKill,
        SUM(COALESCE(server_stats.total_kills, 0) + COALESCE(server_stats.total_joins, 0) + COALESCE(server_stats.total_disconnects, 0)) AS recentEventsCount,
        0 AS structuresBuilt,
        0 AS buildScore
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .first<TotalsRow>()
    .catch(() => null);
  return row ?? {
    serversLinked: 0,
    statsActiveServers: 0,
    players_online: 0,
    currentPlayersOnline: 0,
    maxPlayersCapacity: 0,
    playerCountFreshServers: 0,
    playerCountStaleServers: 0,
    playersSeenFromStats: 0,
    killsTracked: 0,
    deathsTracked: 0,
    joinsTracked: 0,
    longestKill: 0,
    recentEventsCount: 0,
    structuresBuilt: 0,
    buildScore: 0,
  };
}

async function buildHomeStats(env: Env) {
  const db = requireDb(env);
  const [totals, profileCount, recentEventsCount, gameModes, topServers, topPlayers, recentActivity, mapNodes, topBuildServers, lastSuccessfulAdmImportAt, admSummary] = await Promise.all([
    getTotals(db),
    getPlayerProfileCount(db),
    getRecentEventsCount(db),
    getGameModes(db),
    getTopServers(env),
    getTopPlayers(db),
    getRecentActivity(db),
    getMapNodes(db),
    getRankedBuildServers(env, 10),
    getLastSuccessfulAdmImportAt(db),
    getPublicAdmStatsSummary(db),
  ]);
  const totalEventsTracked = await getMonotonicNetworkEventTotal(env, admSummary.totalEventsTracked);
  const buildLeaderboardRows = await buildBuildLeaderboardRows(db, topBuildServers);

  const playersSeen = Math.max(numberOrZero(totals.playersSeenFromStats), profileCount);
  const syncActive = numberOrZero(totals.statsActiveServers);
  const serversLinked = numberOrZero(totals.serversLinked);
  const playersOnline = numberOrZero(totals.players_online ?? totals.currentPlayersOnline);

  return {
    ok: true,
    lastSuccessfulAdmImportAt,
    totals: {
      serversLinked,
      statsActiveServers: syncActive,
      players_online: playersOnline,
      currentPlayersOnline: playersOnline,
      maxPlayersCapacity: numberOrZero(totals.maxPlayersCapacity),
      playerCountFreshServers: numberOrZero(totals.playerCountFreshServers),
      playerCountStaleServers: numberOrZero(totals.playerCountStaleServers),
      playersSeen,
      killsTracked: admSummary.killsTracked,
      deathsTracked: admSummary.deathsTracked,
      joinsTracked: admSummary.joinsTracked,
      longestKill: admSummary.longestKill,
      totalEventsTracked,
      recentEventsCount,
      structuresBuilt: numberOrZero(totals.structuresBuilt),
      buildScore: numberOrZero(totals.buildScore),
    },
    network_pulse: {
      active_servers: syncActive,
      events: totalEventsTracked,
      top_server: topServers[0] ?? null,
      best_kd: topServers[0]?.total_deaths
        ? Number((numberOrZero(topServers[0]?.total_kills) / numberOrZero(topServers[0]?.total_deaths)).toFixed(2))
        : topServers[0] && numberOrZero(topServers[0]?.total_kills) > 0
          ? null
          : null,
      current_event: getCurrentPublicEvent(),
    },
    event_leaderboard: {
      event_type: "build",
      title: "Build Tracking Leaderboard",
      subtitle: "Live build intelligence across connected servers",
      refresh_label: "Refreshes every 5 minutes",
      rows: buildLeaderboardRows,
    },
    top_build_servers: topBuildServers,
    topServers,
    topPlayers,
    recentActivity,
    map_nodes: mapNodes,
    gameModes,
    syncHealth: {
      active: syncActive,
      pending: Math.max(serversLinked - syncActive, 0),
    },
  };
}

async function getTotals(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
        COUNT(linked_servers.id) AS serversLinked,
        SUM(COALESCE(${PUBLIC_CURRENT_PLAYERS_SQL}, 0)) AS players_online,
        SUM(COALESCE(${PUBLIC_CURRENT_PLAYERS_SQL}, 0)) AS currentPlayersOnline,
        SUM(COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, 0)) AS maxPlayersCapacity,
        SUM(CASE WHEN ${PUBLIC_PLAYER_COUNT_FRESH_SQL} THEN 1 ELSE 0 END) AS playerCountFreshServers,
        SUM(CASE WHEN ${PUBLIC_PLAYER_COUNT_FRESH_SQL} THEN 0 ELSE 1 END) AS playerCountStaleServers,
        SUM(
          CASE
            WHEN COALESCE(server_stats.total_joins, 0) > 0
              OR COALESCE(server_stats.total_disconnects, 0) > 0
              OR COALESCE(server_stats.total_deaths, 0) > 0
              OR COALESCE(server_stats.total_kills, 0) > 0
              OR COALESCE(server_stats.unique_players, 0) > 0
              OR COALESCE(server_build_stats.build_score, 0) > 0
              OR COALESCE(server_build_stats.structures_built, 0) > 0
              OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              OR EXISTS (
                SELECT 1
                FROM sync_runs
                WHERE sync_runs.linked_server_id = linked_servers.id
                  AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
                LIMIT 1
              )
            THEN 1 ELSE 0
          END
        ) AS statsActiveServers,
        SUM(COALESCE(server_stats.unique_players, 0)) AS playersSeenFromStats,
        (
          SELECT COUNT(*)
          FROM kill_events
          INNER JOIN linked_servers AS live_kill_servers ON live_kill_servers.id = kill_events.linked_server_id
          WHERE lower(live_kill_servers.status) = 'live'
            AND ${PUBLIC_LIVE_KILL_SERVER_LIFECYCLE_SQL}
            AND lower(COALESCE(live_kill_servers.listing_visibility, 'public')) != 'hidden'
            AND (live_kill_servers.merged_into_server_id IS NULL OR live_kill_servers.merged_into_server_id = '')
        ) AS killsTracked,
        (
          SELECT COUNT(*)
          FROM kill_events
          INNER JOIN linked_servers AS live_death_servers ON live_death_servers.id = kill_events.linked_server_id
          WHERE lower(live_death_servers.status) = 'live'
            AND ${PUBLIC_LIVE_DEATH_SERVER_LIFECYCLE_SQL}
            AND lower(COALESCE(live_death_servers.listing_visibility, 'public')) != 'hidden'
            AND (live_death_servers.merged_into_server_id IS NULL OR live_death_servers.merged_into_server_id = '')
            AND kill_events.victim_name IS NOT NULL
        ) AS deathsTracked,
        SUM(COALESCE(server_stats.total_joins, 0)) AS joinsTracked,
        (
          SELECT MAX(COALESCE(kill_events.distance, 0))
          FROM kill_events
          INNER JOIN linked_servers AS live_longest_servers ON live_longest_servers.id = kill_events.linked_server_id
          WHERE lower(live_longest_servers.status) = 'live'
            AND ${PUBLIC_LIVE_LONGEST_SERVER_LIFECYCLE_SQL}
            AND lower(COALESCE(live_longest_servers.listing_visibility, 'public')) != 'hidden'
            AND (live_longest_servers.merged_into_server_id IS NULL OR live_longest_servers.merged_into_server_id = '')
        ) AS longestKill,
        (
          SELECT SUM(COALESCE(server_build_stats.structures_built, 0))
          FROM server_build_stats
          INNER JOIN linked_servers AS build_servers ON build_servers.id = server_build_stats.linked_server_id
          WHERE ${PUBLIC_HISTORICAL_BUILD_SERVER_LIFECYCLE_SQL}
            AND lower(COALESCE(build_servers.listing_visibility, 'public')) != 'hidden'
            AND (build_servers.merged_into_server_id IS NULL OR build_servers.merged_into_server_id = '')
        ) AS structuresBuilt,
        (
          SELECT SUM(COALESCE(server_build_stats.build_score, 0))
          FROM server_build_stats
          INNER JOIN linked_servers AS build_servers ON build_servers.id = server_build_stats.linked_server_id
          WHERE ${PUBLIC_HISTORICAL_BUILD_SERVER_LIFECYCLE_SQL}
            AND lower(COALESCE(build_servers.listing_visibility, 'public')) != 'hidden'
            AND (build_servers.merged_into_server_id IS NULL OR build_servers.merged_into_server_id = '')
        ) AS buildScore
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_build_stats ON server_build_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .first<TotalsRow>();
  return row ?? {
    serversLinked: 0,
    statsActiveServers: 0,
    players_online: 0,
    currentPlayersOnline: 0,
    maxPlayersCapacity: 0,
    playerCountFreshServers: 0,
    playerCountStaleServers: 0,
    playersSeenFromStats: 0,
    killsTracked: 0,
    deathsTracked: 0,
    joinsTracked: 0,
    longestKill: 0,
    structuresBuilt: 0,
    buildScore: 0,
  };
}

async function getPreviewTopServers(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        COALESCE(server_stats.total_kills, 0) AS total_kills,
        COALESCE(server_stats.total_deaths, 0) AS total_deaths,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        0 AS longest_kill,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
            OR COALESCE(server_public_cache.updated_at, server_public_cache.last_status_update_at, server_public_cache.last_adm_update_at) IS NOT NULL
          THEN 1 ELSE 0
        END AS stats_active,
        COALESCE(server_public_cache.updated_at, server_public_cache.last_status_update_at, server_public_cache.last_adm_update_at, linked_servers.updated_at, linked_servers.created_at) AS updated_at
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY stats_active DESC, updated_at DESC
       LIMIT 3`,
    )
    .all<PreviewTopServerRow>();

  return (result.results ?? []).map((server, index) => ({
    public_slug: server.public_slug,
    server_name: server.server_name,
    guild_name: null,
    server_type: normalizeText(server.server_type, "UNKNOWN"),
    total_kills: numberOrZero(server.total_kills),
    total_deaths: numberOrZero(server.total_deaths),
    unique_players: numberOrZero(server.unique_players),
    total_joins: numberOrZero(server.total_joins),
    longest_kill: numberOrZero(server.longest_kill),
    stats_active: numberOrZero(server.stats_active),
    rank: index + 1,
    score: 0,
    score_label: "Login required",
    score_breakdown: null,
    updated_at: server.updated_at,
  }));
}

function buildPreviewRecentActivity(topServers: Array<{ server_name: string | null; public_slug: string | null; total_kills: number; total_joins: number; stats_active: number; updated_at?: string | null }>) {
  return topServers
    .filter((server) => numberOrZero(server.stats_active) > 0)
    .slice(0, 4)
    .map((server) => ({
      source: "sync",
      eventType: "sync_completed",
      title: `${server.server_name ?? "DZN Server"} ADM sync updated`,
      serverName: server.server_name,
      publicSlug: server.public_slug,
      occurredAt: server.updated_at ?? null,
      killerName: null,
      victimName: null,
      weapon: null,
      distance: null,
    }));
}

async function getPreviewMapNodes(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.status,
        linked_servers.merged_into_server_id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        discord_guilds.name AS guild_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.region,
        linked_servers.platform,
        linked_servers.map_name,
        linked_servers.geo_latitude,
        linked_servers.geo_longitude,
        linked_servers.geo_country,
        linked_servers.geo_region,
        linked_servers.geo_city,
        linked_servers.geo_timezone,
        linked_servers.geo_source,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
            OR COALESCE(server_public_cache.last_adm_update_at, '') <> ''
            OR COALESCE(adm_sync_state.last_processed_file, '') <> ''
          THEN 1 ELSE 0
        END AS stats_active
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY COALESCE(server_public_cache.last_adm_update_at, server_stats.updated_at, linked_servers.updated_at, linked_servers.created_at) DESC
       LIMIT 80`,
    )
    .all<MapNodeRow>()
    .catch(() => ({ results: [] as MapNodeRow[] }));
  return buildPublicMapNodesFromRows(result.results ?? []);
}

async function buildBuildLeaderboardRows(db: D1Database, rows: PublicBuildLeaderboardRow[]) {
  if (!rows.some((row) => numberOrZero(row.build_score) > 0 || numberOrZero(row.structures_built) > 0)) return [];

  const breakdowns = await getBuildLeaderboardBreakdowns(db);
  return buildPublicBuildEventLeaderboardRows(rows, breakdowns);
}

async function getLastSuccessfulAdmImportAt(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT MAX(value) AS lastSuccessfulAdmImportAt
       FROM (
         SELECT server_public_cache.last_adm_update_at AS value
         FROM linked_servers
         INNER JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND server_public_cache.last_adm_update_at IS NOT NULL
         UNION ALL
         SELECT adm_sync_state.last_sync_at AS value
         FROM linked_servers
         INNER JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND adm_sync_state.last_sync_at IS NOT NULL
           AND lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'completed_with_warnings', 'adm_backfill_caught_up', 'caught_up_waiting_for_growth', 'processed', 'completed_empty', 'completed_closed', 'processing_in_chunks')
         UNION ALL
         SELECT COALESCE(adm_import_jobs.completed_at, adm_import_jobs.updated_at, adm_import_jobs.created_at) AS value
         FROM adm_import_jobs
         INNER JOIN linked_servers ON linked_servers.id = adm_import_jobs.server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND lower(COALESCE(adm_import_jobs.source, '')) = 'scheduled_nitrado'
           AND lower(COALESCE(adm_import_jobs.status, '')) IN ('completed', 'completed_empty', 'completed_no_new_events', 'completed_closed', 'caught_up_waiting_for_growth')
       )`,
    )
    .first<{ lastSuccessfulAdmImportAt: string | null }>()
    .catch(() => null);
  return firstString(row?.lastSuccessfulAdmImportAt);
}

export function buildPublicBuildEventLeaderboardRows(rows: PublicBuildLeaderboardRow[], breakdowns = new Map<string, Partial<BuildBreakdownRow>>()) {
  const rankedRows = rows
    .filter((row) => numberOrZero(row.build_score) > 0 || numberOrZero(row.structures_built) > 0)
    .sort((left, right) => {
      const scoreDiff = numberOrZero(right.build_score) - numberOrZero(left.build_score);
      if (scoreDiff !== 0) return scoreDiff;
      const structuresDiff = numberOrZero(right.structures_built) - numberOrZero(left.structures_built);
      if (structuresDiff !== 0) return structuresDiff;
      return numberOrZero(Date.parse(right.last_build_at ?? "")) - numberOrZero(Date.parse(left.last_build_at ?? ""));
    })
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return rankedRows.map<BuildLeaderboardRow>((row) => {
    const breakdown = breakdowns.get(row.server_id);
    return {
      ...row,
      full_walls_built: numberOrZero(breakdown?.full_walls_built),
      watchtowers_built: numberOrZero(breakdown?.watchtowers_built),
      gates_fence_kits_built: numberOrZero(breakdown?.gates_fence_kits_built),
      storage_expansion_built: numberOrZero(breakdown?.storage_expansion_built),
    };
  });
}

async function getBuildLeaderboardBreakdowns(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        build_events.linked_server_id,
        SUM(
          CASE
            WHEN build_events.event_type = 'built'
              AND lower(COALESCE(build_events.build_part, '')) IN (
                'wall_base_up', 'wall_base_down', 'wall_wood_up', 'wall_wood_down',
                'wall_metal_up', 'wall_metal_down'
              )
            THEN 1 ELSE 0
          END
        ) AS full_walls_built,
        SUM(
          CASE
            WHEN lower(COALESCE(build_events.build_part, '')) LIKE 'watchtower%'
              OR lower(COALESCE(build_events.placed_class, '')) IN ('watchtowerkit')
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%watchtower%'
              OR lower(COALESCE(build_events.target_object, '')) = 'watchtower'
            THEN 1 ELSE 0
          END
        ) AS watchtowers_built,
        SUM(
          CASE
            WHEN lower(COALESCE(build_events.build_part, '')) = 'wall_gate'
              OR lower(COALESCE(build_events.placed_class, '')) IN ('fencekit')
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%fence%kit%'
              OR lower(COALESCE(build_events.target_object, '')) IN ('fence', 'gate')
            THEN 1 ELSE 0
          END
        ) AS gates_fence_kits_built,
        SUM(
          CASE
            WHEN lower(COALESCE(build_events.placed_class, '')) LIKE 'woodencrate%'
              OR lower(COALESCE(build_events.placed_class, '')) LIKE 'barrel%'
              OR lower(COALESCE(build_events.placed_class, '')) LIKE 'seachest%'
              OR lower(COALESCE(build_events.placed_class, '')) LIKE '%tent%'
              OR lower(COALESCE(build_events.placed_class, '')) LIKE '%shelter%'
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%crate%'
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%barrel%'
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%sea chest%'
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%tent%'
              OR lower(COALESCE(build_events.placed_object, '')) LIKE '%shelter%'
            THEN 1 ELSE 0
          END
        ) AS storage_expansion_built
       FROM build_events
       INNER JOIN linked_servers ON linked_servers.id = build_events.linked_server_id
       WHERE ${PUBLIC_HISTORICAL_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       GROUP BY build_events.linked_server_id`,
    )
    .all<BuildBreakdownRow>();

  return new Map((result.results ?? []).map((row) => [row.linked_server_id, row]));
}

async function getPlayerProfileCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(player_profiles.id) AS count
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND ${mockNameFilterSql("player_profiles.player_name")}`,
    )
    .first<{ count: number | null }>();
  return numberOrZero(row?.count);
}

async function getRecentEventsCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT SUM(count) AS count
       FROM (
         SELECT COUNT(*) AS count
         FROM player_events
         INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND COALESCE(player_events.occurred_at, player_events.created_at) >= datetime('now', '-1 day')
           AND ${mockNameFilterSql("player_events.player_name")}
         UNION ALL
         SELECT COUNT(*) AS count
         FROM kill_events
         INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND COALESCE(kill_events.occurred_at, kill_events.created_at) >= datetime('now', '-1 day')
           AND ${mockNameFilterSql("kill_events.killer_name")}
           AND ${mockNameFilterSql("kill_events.victim_name")}
         UNION ALL
         SELECT COUNT(*) AS count
         FROM build_events
         INNER JOIN linked_servers ON linked_servers.id = build_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND COALESCE(build_events.occurred_at, build_events.created_at) >= datetime('now', '-1 day')
           AND ${mockNameFilterSql("build_events.player_name")}
       )`,
    )
    .first<{ count: number | null }>();
  return numberOrZero(row?.count);
}

export async function getMonotonicNetworkEventTotal(env: Env, calculatedTotal?: number | null) {
  if (!env.DB) return numberOrZero(calculatedTotal);
  const db = requireDb(env);
  const calculated = calculatedTotal === undefined
    ? await getCalculatedNetworkEventTotal(db)
    : numberOrZero(calculatedTotal);
  const cachedTotals = await Promise.all(
    Object.values(HOME_STATS_SNAPSHOT_KEYS).map(async (cacheKey) => {
      const cached = await readPublicApiCache<unknown>(env, cacheKey).catch(() => null);
      return extractHomeStatsEventTotal(cached?.payload);
    }),
  );
  const cachedTotal = Math.max(0, ...cachedTotals);
  const keptTotal = Math.max(calculated, cachedTotal);
  if (keptTotal > calculated) {
    console.warn("DZN HOME STATS MONOTONIC EVENT TOTAL KEPT", {
      previous_total: cachedTotal,
      attempted_total: calculated,
      kept_total: keptTotal,
      reason: "public_home_stats_monotonic_guard",
      created_at: new Date().toISOString(),
    });
  }
  return keptTotal;
}

async function getCalculatedNetworkEventTotal(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT SUM(count) AS count
       FROM (
         SELECT COUNT(*) AS count
         FROM kill_events
         INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND ${mockNameFilterSql("kill_events.killer_name")}
           AND ${mockNameFilterSql("kill_events.victim_name")}
         UNION ALL
         SELECT COUNT(*) AS count
         FROM player_events
         INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND ${mockNameFilterSql("player_events.player_name")}
         UNION ALL
        SELECT COUNT(*) AS count
        FROM build_events
        INNER JOIN linked_servers AS build_servers ON build_servers.id = build_events.linked_server_id
        WHERE ${PUBLIC_HISTORICAL_BUILD_SERVER_LIFECYCLE_SQL}
          AND lower(COALESCE(build_servers.listing_visibility, 'public')) != 'hidden'
          AND (build_servers.merged_into_server_id IS NULL OR build_servers.merged_into_server_id = '')
          AND ${mockNameFilterSql("build_events.player_name")}
      )`,
    )
    .first<{ count: number | null }>()
    .catch(() => null);
  if (row) return numberOrZero(row.count);
  return getServerStatsNetworkEventTotal(db);
}

async function getServerStatsNetworkEventTotal(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT SUM(
        COALESCE(server_stats.total_kills, 0)
        + COALESCE(server_stats.total_deaths, 0)
        + COALESCE(server_stats.total_joins, 0)
        + COALESCE(server_stats.total_disconnects, 0)
      ) AS count
       FROM server_stats
       INNER JOIN linked_servers ON linked_servers.id = server_stats.linked_server_id
       WHERE ${PUBLIC_HISTORICAL_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .first<{ count: number | null }>()
    .catch(() => null);
  return numberOrZero(row?.count);
}

function extractHomeStatsEventTotal(payload: unknown): number {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  return Math.max(
    extractHomeStatsEventTotalFromRecord(root),
    extractHomeStatsEventTotalFromRecord(data),
  );
}

function extractHomeStatsEventTotalFromRecord(record: Record<string, unknown>): number {
  const totals = isRecord(record.totals) ? record.totals : {};
  const networkPulse = isRecord(record.network_pulse) ? record.network_pulse : {};
  return Math.max(
    numberOrZero(record.totalEventsTracked),
    numberOrZero(totals.totalEventsTracked),
    numberOrZero(networkPulse.events),
    numberOrZero(record.recentEventsCount),
    numberOrZero(totals.recentEventsCount),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function getGameModes(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT server_type, COUNT(*) AS count
       FROM (
         SELECT COALESCE(NULLIF(server_category, ''), NULLIF(server_mode, ''), server_type) AS server_type
         FROM linked_servers
         WHERE lower(status) = 'live'
           AND lower(COALESCE(listing_visibility, 'public')) != 'hidden'
       )
       GROUP BY server_type`,
    )
    .all<GameModeRow>();

  const counts = {
    pvp: 0,
    pve: 0,
    deathmatch: 0,
    pvpPve: 0,
  };

  for (const row of result.results ?? []) {
    const type = (row.server_type ?? "").toUpperCase();
    if (type === "PVP") counts.pvp = numberOrZero(row.count);
    if (type === "PVE") counts.pve = numberOrZero(row.count);
    if (type === "DEATHMATCH") counts.deathmatch = numberOrZero(row.count);
    if (type === "PVP / PVE" || type === "PVP_PVE") counts.pvpPve = numberOrZero(row.count);
  }

  return counts;
}

async function getTopServers(env: Env) {
  const ranked = await getRankedPublicServers(env, 6);
  return ranked.map((server) => ({
    public_slug: server.slug,
    server_name: server.server_name,
    guild_name: null,
    server_type: server.mode,
    total_kills: server.kills,
    total_deaths: server.deaths,
    unique_players: server.unique_players,
    total_joins: server.joins,
    longest_kill: server.longest_kill,
    stats_active: server.stats_sync_active ? 1 : 0,
    rank: server.rank,
    score: server.score,
    score_label: server.score_label,
    score_breakdown: server.score_breakdown,
  }));
}

async function getTopPlayers(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        player_profiles.player_name,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug,
        player_profiles.kills,
        player_profiles.deaths,
        player_profiles.longest_kill_distance
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND ${mockNameFilterSql("player_profiles.player_name")}
       ORDER BY player_profiles.kills DESC, player_profiles.longest_kill_distance DESC, player_profiles.updated_at DESC
       LIMIT 5`,
    )
    .all<TopPlayerRow>();

  return (result.results ?? [])
    .filter((row) => numberOrZero(row.kills) > 0)
    .map((row, index) => {
      const kills = numberOrZero(row.kills);
      const deaths = numberOrZero(row.deaths);
      return {
        rank: index + 1,
        playerName: row.player_name,
        serverName: row.server_name,
        publicSlug: row.public_slug,
        kills,
        deaths,
        kd: deaths === 0 ? kills : Number((kills / deaths).toFixed(2)),
        longestKill: numberOrZero(row.longest_kill_distance),
      };
    });
}

async function getRecentActivity(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT *
       FROM (
         SELECT
           'kill' AS source,
           'player_killed' AS event_type,
           COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
           linked_servers.public_slug,
           NULL AS player_name,
           kill_events.killer_name,
           kill_events.victim_name,
           kill_events.weapon,
           kill_events.distance,
           NULL AS build_part,
           NULL AS target_object,
           NULL AS placed_object,
           NULL AS placed_class,
           kill_events.occurred_at,
           kill_events.created_at,
           COALESCE(kill_events.occurred_at, kill_events.created_at) AS sort_time
         FROM kill_events
         INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND ${mockNameFilterSql("kill_events.killer_name")}
           AND ${mockNameFilterSql("kill_events.victim_name")}
         UNION ALL
         SELECT
           'player' AS source,
           player_events.event_type,
           COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
           linked_servers.public_slug,
           player_events.player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           NULL AS build_part,
           NULL AS target_object,
           NULL AS placed_object,
           NULL AS placed_class,
           player_events.occurred_at,
           player_events.created_at,
           COALESCE(player_events.occurred_at, player_events.created_at) AS sort_time
         FROM player_events
         INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND ${mockNameFilterSql("player_events.player_name")}
         UNION ALL
         SELECT
           'build' AS source,
           build_events.event_type,
           COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
           linked_servers.public_slug,
           build_events.player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           build_events.tool AS weapon,
           NULL AS distance,
           build_events.build_part,
           build_events.target_object,
           build_events.placed_object,
           build_events.placed_class,
           build_events.occurred_at,
           build_events.created_at,
           COALESCE(build_events.occurred_at, build_events.created_at) AS sort_time
         FROM build_events
         INNER JOIN linked_servers ON linked_servers.id = build_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND ${mockNameFilterSql("build_events.player_name")}
         UNION ALL
         SELECT
           'sync' AS source,
           'sync_completed' AS event_type,
           COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
           linked_servers.public_slug,
           NULL AS player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           NULL AS build_part,
           NULL AS target_object,
           NULL AS placed_object,
           NULL AS placed_class,
           COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) AS occurred_at,
           sync_runs.created_at,
           COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) AS sort_time
         FROM sync_runs
         INNER JOIN linked_servers ON linked_servers.id = sync_runs.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
         UNION ALL
         SELECT
           'server' AS source,
           'server_joined' AS event_type,
           COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
           linked_servers.public_slug,
           NULL AS player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           NULL AS build_part,
           NULL AS target_object,
           NULL AS placed_object,
           NULL AS placed_class,
           linked_servers.created_at AS occurred_at,
           linked_servers.created_at,
           linked_servers.created_at AS sort_time
         FROM linked_servers
         WHERE lower(linked_servers.status) = 'live'
           AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       )
       ORDER BY sort_time DESC
       LIMIT 8`,
    )
    .all<RecentActivityRow>();

  return (result.results ?? []).map((row) => ({
    source: row.source,
    eventType: row.event_type,
    title: activityTitle(row),
    serverName: row.server_name,
    publicSlug: row.public_slug,
    occurredAt: row.occurred_at ?? row.created_at,
    killerName: row.source === "kill" ? row.killer_name : null,
    victimName: row.source === "kill" ? row.victim_name : null,
    weapon: row.source === "kill" ? row.weapon : null,
    distance: row.source === "kill" ? finiteNumber(row.distance) : null,
  }));
}

async function getMapNodes(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.status,
        linked_servers.merged_into_server_id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        discord_guilds.name AS guild_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.region,
        linked_servers.platform,
        linked_servers.map_name,
        linked_servers.geo_latitude,
        linked_servers.geo_longitude,
        linked_servers.geo_country,
        linked_servers.geo_region,
        linked_servers.geo_city,
        linked_servers.geo_timezone,
        linked_servers.geo_source,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
            OR COALESCE(server_build_stats.build_score, 0) > 0
            OR COALESCE(server_build_stats.structures_built, 0) > 0
            OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
            OR EXISTS (
              SELECT 1
              FROM sync_runs
              WHERE sync_runs.linked_server_id = linked_servers.id
                AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              LIMIT 1
            )
          THEN 1 ELSE 0
        END AS stats_active
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_build_stats ON server_build_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LINKED_SERVER_LIFECYCLE_SQL}
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY linked_servers.updated_at DESC, linked_servers.created_at DESC
       LIMIT 80`,
    )
    .all<MapNodeRow>();

  return buildPublicMapNodesFromRows(result.results ?? []);
}

export function buildPublicMapNodesFromRows(rows: MapNodeRow[]) {
  const coordinateCounts = new Map<string, number>();
  return rows.flatMap((row, index) => {
    if (!publicMapNodeRowIsVisible(row)) return [];
    const node = buildPublicMapNodeFromRow(row, index, coordinateCounts);
    return node ? [node] : [];
  });
}

function publicMapNodeRowIsVisible(row: MapNodeRow) {
  const status = (row.status ?? "live").toLowerCase();
  const mergedInto = row.merged_into_server_id?.trim();
  return status === "live" && !mergedInto;
}

export function buildPublicMapNodeFromRow(row: MapNodeRow, index = 0, coordinateCounts = new Map<string, number>()) {
  const serverName = firstString(row.server_name, row.guild_name) ?? "Unnamed DZN Server";
  const placement = mapPlacementFor(row);

  const key = `${Math.round(placement.latitude * 10) / 10}:${Math.round(placement.longitude * 10) / 10}`;
  const count = coordinateCounts.get(key) ?? 0;
  coordinateCounts.set(key, count + 1);
  const offset = nodeLatLngOffset(count);
  const latitude = clamp(placement.latitude + offset.latitude, -82, 82);
  const longitude = clamp(placement.longitude + offset.longitude, -180, 180);
  const active = Number(row.stats_active) === 1;
  const x = ((longitude + 180) / 360) * 100;
  const y = ((90 - latitude) / 180) * 100;

  return {
    id: row.public_slug ?? row.id ?? `server-${index + 1}`,
    name: serverName,
    display_name: serverName,
    slug: row.public_slug,
    mode: normalizeText(row.server_type, "UNKNOWN"),
    server_type: normalizeText(row.server_type, "UNKNOWN"),
    status: active ? "active" : "pending",
    sync_status: active ? "active" : "pending",
    active,
    latitude: roundFour(latitude),
    longitude: roundFour(longitude),
    lat: roundFour(latitude),
    lng: roundFour(longitude),
    x: roundOne(clamp(x, 5, 95)),
    y: roundOne(clamp(y, 8, 90)),
    country: placement.country,
    region: placement.locationLabel,
    city: placement.city,
    approximate: placement.approximate,
    location_label: placement.locationLabel,
  };
}

function mapPlacementFor(row: MapNodeRow) {
  const geoLatitude = finiteNumber(row.geo_latitude);
  const geoLongitude = finiteNumber(row.geo_longitude);
  if (geoLatitude !== null && geoLongitude !== null) {
    const approximate = row.geo_source === "region-fallback";
    const location = {
      latitude: clamp(geoLatitude, -90, 90),
      longitude: clamp(geoLongitude, -180, 180),
      country: row.geo_country,
      region: row.geo_region,
      city: row.geo_city,
      approximate,
    };
    return {
      ...location,
      locationLabel: formatLocationLabel(location),
    };
  }

  const rawRegion = firstString(row.region);
  const publicRegion = safePublicRegion(rawRegion);
  const searchable = [publicRegion, row.server_name, row.guild_name, row.platform, row.map_name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  const location = approximateRegion(searchable);
  if (location) {
    const fallbackLocation = {
      latitude: location.latitude,
      longitude: location.longitude,
      country: location.country,
      region: publicRegion ?? location.label,
      city: null,
      approximate: true,
    };
    return {
      ...fallbackLocation,
      locationLabel: formatLocationLabel(fallbackLocation),
      approximate: true,
    };
  }

  return {
    latitude: 20,
    longitude: 0,
    country: null,
    region: null,
    city: null,
    locationLabel: "Location awaiting metadata",
    approximate: true,
  };
}

function approximateRegion(value: string) {
  const checks: Array<{ terms: string[]; latitude: number; longitude: number; label: string; country: string | null }> = [
    { terms: ["united kingdom", "great britain", " britain", " gb ", " uk ", "london", "england", "scotland", "wales"], latitude: 54.3, longitude: -2.5, label: "United Kingdom", country: "United Kingdom" },
    { terms: ["germany", "deutschland", "berlin", "frankfurt", "eu-central"], latitude: 50.8, longitude: 10.2, label: "Europe", country: null },
    { terms: ["europe", " eu ", "eu-west", "france", "spain", "italy", "netherlands", "poland"], latitude: 50.8, longitude: 10.2, label: "Europe", country: null },
    { terms: ["north america", " usa", " us ", "united states", "america", "canada", "mexico", "us-east", "us-west"], latitude: 39.5, longitude: -98.35, label: "North America", country: null },
    { terms: ["south america", "brazil", "argentina", "chile"], latitude: -15.7, longitude: -58.4, label: "South America", country: null },
    { terms: ["asia", "singapore", "japan", "korea", "china", "india"], latitude: 32.4, longitude: 88.2, label: "Asia", country: null },
    { terms: ["oceania", "australia", "sydney", "new zealand"], latitude: -25.3, longitude: 134.5, label: "Oceania", country: null },
  ];

  const padded = ` ${value} `;
  return checks.find((check) => check.terms.some((term) => padded.includes(term)));
}

function safePublicRegion(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(trimmed)) return null;
  if (/^[a-f0-9:]+$/i.test(trimmed) && trimmed.includes(":")) return null;
  return trimmed.slice(0, 80);
}

function nodeLatLngOffset(index: number) {
  const offsets = [
    { latitude: 0, longitude: 0 },
    { latitude: 1.2, longitude: 1.7 },
    { latitude: -1.2, longitude: -1.7 },
    { latitude: 0.9, longitude: -2.1 },
    { latitude: -0.9, longitude: 2.1 },
    { latitude: 1.9, longitude: 0.4 },
    { latitude: -1.9, longitude: -0.4 },
  ];
  return offsets[index % offsets.length];
}

function getCurrentPublicEvent() {
  return null;
}

function activityTitle(row: RecentActivityRow) {
  if (row.source === "kill") {
    const weapon = row.weapon ? ` with ${row.weapon}` : "";
    return `${row.killer_name ?? "Player"} eliminated ${row.victim_name ?? "a player"}${weapon}`;
  }
  if (row.source === "build") {
    if (row.event_type === "built") {
      const part = row.build_part ? row.build_part.replace(/_/g, " ") : "a structure";
      return `${row.player_name ?? "A player"} built ${part}`;
    }
    if (row.event_type === "placed") {
      return `${row.player_name ?? "A player"} placed ${row.placed_object ?? row.placed_class ?? "a build item"}`;
    }
    if (row.event_type === "dismantled") return `${row.player_name ?? "A player"} dismantled a structure`;
    if (row.event_type === "folded") return `${row.player_name ?? "A player"} folded ${row.target_object ?? row.placed_object ?? "a structure"}`;
    if (row.event_type === "flag_raised") return `${row.player_name ?? "A player"} raised ${row.placed_class ?? "a territory flag"}`;
    if (row.event_type === "flag_lowered") return `${row.player_name ?? "A player"} lowered ${row.placed_class ?? "a territory flag"}`;
  }
  if (row.event_type === "player_connected") return `${row.player_name ?? "A player"} connected`;
  if (row.event_type === "player_disconnected") return `${row.player_name ?? "A player"} disconnected`;
  if (row.event_type === "player_suicide") return `${row.player_name ?? "A player"} died`;
  if (row.event_type === "player_killed_environment" || row.event_type === "player_died_stats") return `${row.player_name ?? "A player"} death recorded`;
  if (row.event_type === "player_placed_object") return `${row.player_name ?? "A player"} placed an object`;
  if (row.source === "sync") return `${row.server_name ?? "Server"} sync completed`;
  if (row.source === "server") return `${row.server_name ?? "A server"} joined DZN Network`;
  return `${row.server_name ?? "Server"} activity synced`;
}

function mockNameFilterSql(column: string) {
  return `(${column} IS NULL OR (${MOCK_PLAYER_PREFIXES.map((prefix) => `${column} NOT LIKE '${prefix}%'`).join(" AND ")}))`;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeText(value: string | null, fallback: string) {
  const text = value?.replace(/_/g, " ").trim();
  return text ? text.toUpperCase() : fallback;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function roundOne(value: number) {
  return Math.round(numberOrZero(value) * 10) / 10;
}

function roundFour(value: number) {
  return Math.round(numberOrZero(value) * 10000) / 10000;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function emptyHomeStats() {
  return {
    ok: true,
    totals: {
      serversLinked: 0,
      statsActiveServers: 0,
      players_online: 0,
      currentPlayersOnline: 0,
      maxPlayersCapacity: 0,
      playerCountFreshServers: 0,
      playerCountStaleServers: 0,
      playersSeen: 0,
      killsTracked: 0,
      deathsTracked: 0,
      joinsTracked: 0,
      longestKill: 0,
      totalEventsTracked: 0,
      recentEventsCount: 0,
      structuresBuilt: 0,
      buildScore: 0,
    },
    network_pulse: {
      active_servers: 0,
      events: 0,
      top_server: null,
      best_kd: null,
      current_event: null,
    },
    event_leaderboard: null,
    top_build_servers: [],
    topServers: [],
    topPlayers: [],
    recentActivity: [],
    map_nodes: [],
    gameModes: {
      pvp: 0,
      pve: 0,
      deathmatch: 0,
      pvpPve: 0,
    },
    syncHealth: {
      active: 0,
      pending: 0,
    },
  };
}

export function applyHomeStatsAccess<T extends {
  totals?: Record<string, unknown>;
  network_pulse?: Record<string, unknown>;
  totalEventsTracked?: number | null;
  recentActivityCount?: number | null;
  topServers: Array<Record<string, unknown>>;
  topPlayers: Array<Record<string, unknown>>;
  recentActivity: Array<{ source?: string; serverName?: string | null; title: string } & Record<string, unknown>>;
  top_build_servers: Array<Record<string, unknown>>;
  event_leaderboard: unknown;
  map_nodes?: Array<Record<string, unknown>>;
  syncHealth?: Record<string, unknown>;
}>(data: T, viewerLoggedIn: boolean): T & {
  access_level: "full" | "preview";
  is_locked: boolean;
  locked_reason: string | null;
  loggedIn: boolean;
  previewMode: boolean;
  sections: HomeStatsSections;
} {
  if (viewerLoggedIn) {
    return {
      ...data,
      access_level: "full",
      is_locked: false,
      locked_reason: null,
      loggedIn: true,
      previewMode: false,
      sections: fullHomeStatsSections(),
    };
  }

  return {
    ...data,
    access_level: "preview",
    is_locked: true,
    locked_reason: "Log in with Discord to unlock full network stats.",
    loggedIn: false,
    previewMode: true,
    sections: previewHomeStatsSections(),
        totals: data.totals
      ? {
          ...data.totals,
          playersSeen: 0,
        }
      : data.totals,
    network_pulse: data.network_pulse
      ? {
          ...data.network_pulse,
          top_server: null,
          best_kd: null,
          current_event: null,
        }
      : data.network_pulse,
    topServers: data.topServers.slice(0, 3).map((server) => ({
      ...server,
      total_kills: 0,
      total_deaths: 0,
      unique_players: 0,
      total_joins: 0,
      longest_kill: 0,
      score: 0,
      score_label: "Login required",
      score_breakdown: null,
    })),
    topPlayers: [],
    recentActivity: data.recentActivity.slice(0, 3).map((activity) => ({
      source: activity.source ?? "sync",
      serverName: activity.serverName ?? "DZN Network",
      publicSlug: null,
      occurredAt: null,
      title: activity.source === "server" ? activity.title : `${activity.serverName ?? "Server"} activity synced`,
      eventType: "locked_preview",
    })),
    top_build_servers: [],
    event_leaderboard: null,
    map_nodes: data.map_nodes ?? [],
    syncHealth: data.syncHealth ? { ...data.syncHealth } : data.syncHealth,
  };
}

function previewHomeStatsSections(): HomeStatsSections {
  return {
    topServers: lockedLoginSection(),
    recentActivity: lockedLoginSection(),
    liveGlobeTracker: lockedLoginSection(),
  };
}

function fullHomeStatsSections(): HomeStatsSections {
  return {
    topServers: unlockedSection(),
    recentActivity: unlockedSection(),
    liveGlobeTracker: unlockedSection(),
  };
}

function lockedLoginSection(): HomeStatsSectionAccess {
  return { locked: true, reason: "login_required" };
}

function unlockedSection(): HomeStatsSectionAccess {
  return { locked: false, reason: null };
}
