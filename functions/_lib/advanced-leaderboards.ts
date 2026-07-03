import { ensureAdmSyncSchema } from "./adm-sync";
import { ensureBuildEventSchema } from "./build-events";
import { requireDb } from "./db";
import { getAdvancedShowcaseAccess, type AdvancedShowcaseAccess } from "./advanced-showcase-entitlements";
import { summarizeMapExploration, type ExplorationSummary } from "./map-exploration";
import { resolveDznMapConfig } from "./map-configs";
import { computeTravelStats, type TravelPositionSample, type TravelPlayerStats, type TravelServerStats } from "./travel-stats";
import { getCanonicalServerStats } from "./server-stats";
import type { Env } from "./types";
import {
  SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES,
  serverLifecycleInSql,
  serverLifecycleSqlExpression,
} from "../../lib/server-lifecycle";

export type AdvancedBoardCategory =
  | "overall"
  | "pvp"
  | "deathmatch"
  | "pve"
  | "hybrid"
  | "builds"
  | "survival"
  | "travel"
  | "exploration"
  | "weapons"
  | "premium_showcase";

export type AdvancedBoardRow = {
  rank: number;
  serverId?: string;
  serverSlug?: string | null;
  serverName?: string | null;
  serverMode?: string | null;
  mapName?: string | null;
  playerName?: string | null;
  value: number | string | null;
  displayValue: string;
  topPlayer?: string | null;
  supportingStats?: Record<string, number | string | null | boolean>;
  dataFreshness?: string | null;
  isPremiumShowcase?: boolean;
  estimated?: boolean;
};

export type AdvancedBoard = {
  metricKey: string;
  title: string;
  description: string;
  category: AdvancedBoardCategory;
  packageRequired: "free" | "starter" | "pro" | "premium";
  rows: AdvancedBoardRow[];
  locked?: boolean;
  lockedReason?: string | null;
  estimated?: boolean;
};

export type ServerAdvancedShowcasePayload = {
  ok: true;
  generated_at: string;
  server: {
    id: string;
    slug: string | null;
    name: string;
    mode: string | null;
    mapName: string | null;
  };
  access: AdvancedShowcaseAccess;
  summary: {
    kills: number;
    deaths: number;
    joins: number;
    disconnects: number;
    uniquePlayers: number;
    eventsTracked: number;
    buildScore: number;
    structuresBuilt: number;
    raidScore: number;
    totalDistanceM: number;
    onFootDistanceM: number;
    fastTravelEstimatedDistanceM: number;
    explorationPercent: number;
    estimated: boolean;
    lastUpdatedAt: string | null;
  };
  boards: AdvancedBoard[];
  exploration: ExplorationSummary;
  notes: string[];
};

type PublicServerMeta = {
  id: string;
  public_slug: string | null;
  server_name: string | null;
  server_mode: string | null;
  server_type: string | null;
  map_name: string | null;
  mission: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  updated_at: string | null;
};

type ServerMetricRow = PublicServerMeta & {
  value: number | null;
  top_player?: string | null;
  supporting_a?: number | null;
  supporting_b?: number | null;
  supporting_c?: number | null;
  data_freshness?: string | null;
};

type PlayerMetricRow = {
  player_key: string | null;
  player_name: string | null;
  kills?: number | null;
  deaths?: number | null;
  longest_kill?: number | null;
  favourite_weapon?: string | null;
  head_hits?: number | null;
  event_count?: number | null;
  build_score?: number | null;
  structures_built?: number | null;
  walls_fences?: number | null;
  watchtowers?: number | null;
  gates?: number | null;
  storage_expansion?: number | null;
  repairs?: number | null;
  raid_score?: number | null;
  traps_explosives?: number | null;
  last_event_at?: string | null;
};

type CachedAdvancedValue = {
  expiresAt: number;
  promise: Promise<unknown>;
};

const PUBLIC_ADVANCED_CACHE_TTL_MS = 15_000;
const SERVER_ADVANCED_CACHE_TTL_MS = 30_000;
const MAX_ADVANCED_CACHE_ENTRIES = 80;
const PUBLIC_ADVANCED_POSITION_SAMPLE_LIMIT = 4_000;
const publicAdvancedPayloadCache = new Map<string, CachedAdvancedValue>();
const serverAdvancedPayloadCache = new Map<string, CachedAdvancedValue>();

export async function getPublicAdvancedLeaderboardsPayload(env: Env, options: { limit?: number } = {}) {
  const limit = safeLimit(options.limit, 8, 20);
  return cachedAdvancedPayload(publicAdvancedPayloadCache, `public:${limit}`, PUBLIC_ADVANCED_CACHE_TTL_MS, () => buildPublicAdvancedLeaderboardsPayload(env, { limit }));
}

async function buildPublicAdvancedLeaderboardsPayload(env: Env, options: { limit?: number } = {}) {
  if (!env.DB) return emptyAdvancedLeaderboardsPayload();
  await ensureAdvancedReadSchema(env);
  const limit = safeLimit(options.limit, 8, 20);
  const [serverMeta, pvpBoards, buildBoards, hybridBoards, samples] = await Promise.all([
    queryPublicServerMeta(env),
    queryPvpServerBoards(env, limit),
    queryBuildServerBoards(env, limit),
    queryHybridServerBoards(env, limit),
    queryPositionSamples(env, { limit: PUBLIC_ADVANCED_POSITION_SAMPLE_LIMIT }),
  ]);
  const metaById = new Map(serverMeta.map((server) => [server.id, server]));
  const travelBoards = buildTravelServerBoards(samples, metaById, limit);
  const explorationBoards = buildExplorationServerBoards(samples, serverMeta, limit);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    categories: ["overall", "pvp", "deathmatch", "pve", "hybrid", "builds", "survival", "travel", "exploration", "weapons", "premium_showcase"],
    boards: [...pvpBoards, ...buildBoards, ...hybridBoards, ...travelBoards, ...explorationBoards],
    notes: [
      "All values are derived from imported ADM kill, player, and build events.",
      "Travel and exploration are estimated from bounded ADM position samples and exclude suspicious movement.",
      "Public exploration data is aggregate-only; raw player coordinates and exact routes are not exposed.",
    ],
  };
}

export async function getServerAdvancedShowcasePayload(
  env: Env,
  serverRef: string,
  options: { ownerScoped?: boolean; overlayLimit?: number } = {},
): Promise<ServerAdvancedShowcasePayload | null> {
  const overlayLimit = safeLimit(options.overlayLimit, 220, 500);
  const cacheKey = `${options.ownerScoped ? "owner" : "public"}:${serverRef}:${overlayLimit}`;
  return cachedAdvancedPayload(serverAdvancedPayloadCache, cacheKey, SERVER_ADVANCED_CACHE_TTL_MS, () => buildServerAdvancedShowcasePayload(env, serverRef, {
    ...options,
    overlayLimit,
  }));
}

async function buildServerAdvancedShowcasePayload(
  env: Env,
  serverRef: string,
  options: { ownerScoped?: boolean; overlayLimit?: number } = {},
): Promise<ServerAdvancedShowcasePayload | null> {
  if (!env.DB) return null;
  await ensureAdvancedReadSchema(env);
  const db = requireDb(env);
  const server = await resolveAdvancedServer(env, serverRef, Boolean(options.ownerScoped));
  if (!server) return null;

  const [canonical, pvpPlayers, buildPlayers, samples, eventCounts] = await Promise.all([
    getCanonicalServerStats(db, server.id).catch(() => null),
    queryServerPvpPlayers(env, server.id, 15),
    queryServerBuildPlayers(env, server.id, 15),
    queryPositionSamples(env, { linkedServerId: server.id, limit: 6_000 }),
    queryServerEventCounts(env, server.id),
  ]);
  const access = getAdvancedShowcaseAccess(server.plan_key, server.subscription_status);
  const travel = computeTravelStats(samples);
  const travelPlayers = travel.players.sort((a, b) => b.totalValidDistanceM - a.totalValidDistanceM).slice(0, 15);
  const serverTravel = travel.servers[0] ?? emptyServerTravelStats(server.id);
  const exploration = summarizeMapExploration(server.map_name ?? server.mission, samples, { overlayLimit: options.overlayLimit ?? 220 });
  const explorerPlayers = buildPlayerExplorerRows(samples, server.map_name ?? server.mission).slice(0, 15);
  const buildSummary = summarizeBuildRows(buildPlayers);
  const lastUpdatedAt = latestTimestamp([
    canonical?.lastEventAt ?? null,
    serverTravel.lastTravelSampleAt,
    exploration.lastExplorationUpdateAt,
    buildPlayers[0]?.last_event_at ?? null,
  ]);

  const ownerScoped = Boolean(options.ownerScoped);
  const lockedTop15 = !access.publicServerTop15 && !ownerScoped;
  const lockedOwnerAnalytics = ownerScoped && !access.dashboardAnalytics;
  const canShowExplorationSummary = access.publicExplorationSummary || ownerScoped;
  const canShowMapOverlay = access.publicMapOverlay || ownerScoped;
  const safeExploration = canShowExplorationSummary
    ? canShowMapOverlay ? exploration : { ...exploration, overlayCells: [] }
    : { ...exploration, overlayCells: [] };

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    server: {
      id: server.id,
      slug: server.public_slug,
      name: server.server_name ?? "DZN Server",
      mode: server.server_mode ?? server.server_type,
      mapName: server.map_name ?? server.mission,
    },
    access,
    summary: {
      kills: canonical?.kills ?? 0,
      deaths: canonical?.deaths ?? 0,
      joins: canonical?.joins ?? 0,
      disconnects: canonical?.disconnects ?? 0,
      uniquePlayers: canonical?.uniquePlayers ?? 0,
      eventsTracked: eventCounts.eventsTracked,
      buildScore: buildSummary.buildScore,
      structuresBuilt: buildSummary.structuresBuilt,
      raidScore: buildSummary.raidScore,
      totalDistanceM: serverTravel.totalValidDistanceM,
      onFootDistanceM: serverTravel.totalOnFootDistanceM,
      fastTravelEstimatedDistanceM: serverTravel.totalFastTravelEstimatedDistanceM,
      explorationPercent: exploration.explorationPercent,
      estimated: true,
      lastUpdatedAt,
    },
    boards: [
      boardFromPlayerRows("server_top_kills", "Top 15 Kills", "Confirmed PvP kills on this server.", "pvp", pvpPlayers, "kills", lockedTop15 || lockedOwnerAnalytics, access),
      boardFromPlayerRows("server_top_kd", "Top 15 K/D", "K/D requires at least 10 confirmed kills.", "deathmatch", pvpPlayers.filter((row) => numberOrZero(row.kills) >= 10), "kd", lockedTop15 || lockedOwnerAnalytics, access),
      boardFromPlayerRows("server_longest_kills", "Top 15 Longest Kills", "Longest confirmed kill distances.", "pvp", [...pvpPlayers].sort((a, b) => numberOrZero(b.longest_kill) - numberOrZero(a.longest_kill)), "longest_kill", lockedTop15 || lockedOwnerAnalytics, access),
      boardFromPlayerRows("server_build_score", "Top 15 Build Score", "Build score separates construction from raid/destruction score.", "builds", buildPlayers, "build_score", lockedTop15 || lockedOwnerAnalytics, access),
      boardFromPlayerRows("server_raid_score", "Top 15 Raiders/Dismantles", "Dismantles and destruction are tracked separately from build score.", "pve", [...buildPlayers].sort((a, b) => numberOrZero(b.raid_score) - numberOrZero(a.raid_score)), "raid_score", lockedTop15 || lockedOwnerAnalytics, access),
      boardFromTravelPlayers("server_distance_travelled", "Top 15 Distance Travelled", "Estimated from ADM position samples; suspicious movement is ignored.", travelPlayers, "totalValidDistanceM", lockedTop15 || lockedOwnerAnalytics),
      boardFromTravelPlayers("server_on_foot_explorers", "Top 15 On-Foot Explorers", "Conservative on-foot distance estimate.", travelPlayers, "onFootDistanceM", lockedTop15 || lockedOwnerAnalytics),
      boardFromExplorerPlayers("server_map_completion", "Top 15 Map Completion", "Aggregate grid-cell exploration only; no raw routes are exposed.", explorerPlayers, lockedTop15 || lockedOwnerAnalytics),
    ],
    exploration: safeExploration,
    notes: [
      "Travel and exploration are estimated from ADM position samples.",
      "Headshot kills are not shown as a kill stat until fatal hit-to-kill association is reliable.",
      "Map bounds are configurable and currently marked estimated where licensed map masks/assets are not present.",
    ],
  };
}

function cachedAdvancedPayload<T>(
  cache: Map<string, CachedAdvancedValue>,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  pruneAdvancedCache(cache, now);
  const entry: CachedAdvancedValue = {
    expiresAt: now + ttlMs,
    promise: Promise.resolve(null),
  };
  entry.promise = loader().catch((error) => {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  });
  cache.set(key, entry);
  return entry.promise as Promise<T>;
}

function pruneAdvancedCache(cache: Map<string, CachedAdvancedValue>, now: number) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_ADVANCED_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export async function queryPositionSamples(env: Env, options: { linkedServerId?: string | null; limit?: number } = {}): Promise<TravelPositionSample[]> {
  const db = requireDb(env);
  const limit = safeLimit(options.limit, 2_000, 20_000);
  const serverFilter = options.linkedServerId ? "WHERE linked_server_id = ?" : "";
  const statement = db.prepare(
    `SELECT linked_server_id, player_key, player_name, occurred_at, x, y, z, source_event_type
     FROM (
       SELECT linked_server_id,
              COALESCE(player_id, lower(player_name)) AS player_key,
              player_name,
              COALESCE(occurred_at, created_at) AS occurred_at,
              position_x AS x,
              position_y AS y,
              position_z AS z,
              event_type AS source_event_type
       FROM player_events
       WHERE position_x IS NOT NULL AND position_y IS NOT NULL
       UNION ALL
       SELECT linked_server_id,
              COALESCE(killer_id, lower(killer_name)) AS player_key,
              killer_name AS player_name,
              COALESCE(occurred_at, created_at) AS occurred_at,
              position_x AS x,
              position_y AS y,
              position_z AS z,
              'player_killed' AS source_event_type
       FROM kill_events
       WHERE position_x IS NOT NULL AND position_y IS NOT NULL AND killer_name IS NOT NULL
       UNION ALL
       SELECT linked_server_id,
              COALESCE(player_id, lower(player_name)) AS player_key,
              player_name,
              COALESCE(occurred_at, created_at) AS occurred_at,
              pos_x AS x,
              pos_y AS y,
              pos_z AS z,
              event_type AS source_event_type
       FROM build_events
       WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL
     )
     ${serverFilter}
     ORDER BY occurred_at DESC
     LIMIT ?`,
  );
  const result = options.linkedServerId
    ? await statement.bind(options.linkedServerId, limit).all<{
        linked_server_id: string;
        player_key: string | null;
        player_name: string | null;
        occurred_at: string | null;
        x: number | null;
        y: number | null;
        z: number | null;
        source_event_type: string | null;
      }>()
    : await statement.bind(limit).all<{
        linked_server_id: string;
        player_key: string | null;
        player_name: string | null;
        occurred_at: string | null;
        x: number | null;
        y: number | null;
        z: number | null;
        source_event_type: string | null;
      }>();

  return (result.results ?? [])
    .filter((row) => row.player_key && row.x !== null && row.y !== null)
    .map((row) => ({
      linkedServerId: row.linked_server_id,
      playerKey: row.player_key ?? "unknown",
      playerName: row.player_name,
      occurredAt: row.occurred_at,
      x: numberOrZero(row.x),
      y: numberOrZero(row.y),
      z: row.z,
      sourceEventType: row.source_event_type,
    }));
}

function emptyAdvancedLeaderboardsPayload() {
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    categories: [],
    boards: [],
    notes: ["D1 is not configured in this environment."],
  };
}

async function ensureAdvancedReadSchema(env: Env) {
  await ensureAdmSyncSchema(env);
  await ensureBuildEventSchema(env);
}

async function queryPublicServerMeta(env: Env) {
  const result = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              linked_servers.server_mode,
              linked_servers.server_type,
              linked_servers.map_name,
              linked_servers.mission,
              linked_servers.updated_at,
              ${subscriptionPlanSql()} AS plan_key,
              ${subscriptionStatusSql()} AS subscription_status
       FROM linked_servers
       WHERE ${publicServerWhereSql()}
       LIMIT 500`,
    )
    .all<PublicServerMeta>();
  return result.results ?? [];
}

async function resolveAdvancedServer(env: Env, serverRef: string, ownerScoped: boolean) {
  const where = ownerScoped
    ? `(linked_servers.id = ? OR linked_servers.public_slug = ? OR linked_servers.nitrado_service_id = ?)
       AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
       AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`
    : `(linked_servers.id = ? OR linked_servers.public_slug = ? OR linked_servers.nitrado_service_id = ?)
       AND ${publicServerWhereSql()}`;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              linked_servers.server_mode,
              linked_servers.server_type,
              linked_servers.map_name,
              linked_servers.mission,
              linked_servers.updated_at,
              ${subscriptionPlanSql()} AS plan_key,
              ${subscriptionStatusSql()} AS subscription_status
       FROM linked_servers
       WHERE ${where}
       LIMIT 1`,
    )
    .bind(serverRef, serverRef, serverRef)
    .first<PublicServerMeta>();
}

async function queryPvpServerBoards(env: Env, limit: number): Promise<AdvancedBoard[]> {
  const db = requireDb(env);
  const [kills, kd, longest, uniquePlayers] = await Promise.all([
    db.prepare(serverMetricSql("COUNT(kill_events.id)", "kill_events", "kill_events.linked_server_id = linked_servers.id", "COUNT(kill_events.id) > 0", "COUNT(kill_events.id) DESC")).bind(limit * 3).all<ServerMetricRow>(),
    db.prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              linked_servers.server_mode,
              linked_servers.server_type,
              linked_servers.map_name,
              linked_servers.mission,
              ${subscriptionPlanSql()} AS plan_key,
              ${subscriptionStatusSql()} AS subscription_status,
              COUNT(kill_events.id) AS supporting_a,
              (COUNT(kill_events.id) + (
                SELECT COUNT(*) FROM player_events
                WHERE player_events.linked_server_id = linked_servers.id
                  AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
              )) AS supporting_b,
              CASE
                WHEN (COUNT(kill_events.id) + (
                  SELECT COUNT(*) FROM player_events
                  WHERE player_events.linked_server_id = linked_servers.id
                    AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
                )) = 0 THEN COUNT(kill_events.id)
                ELSE CAST(COUNT(kill_events.id) AS REAL) / (COUNT(kill_events.id) + (
                  SELECT COUNT(*) FROM player_events
                  WHERE player_events.linked_server_id = linked_servers.id
                    AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')
                ))
              END AS value,
              MAX(COALESCE(kill_events.occurred_at, kill_events.created_at)) AS data_freshness
       FROM linked_servers
       LEFT JOIN kill_events ON kill_events.linked_server_id = linked_servers.id
       WHERE ${publicServerWhereSql()}
       GROUP BY linked_servers.id
       HAVING COUNT(kill_events.id) >= 25
       ORDER BY value DESC, supporting_a DESC
       LIMIT ?`,
    ).bind(limit * 3).all<ServerMetricRow>(),
    db.prepare(serverMetricSql("MAX(COALESCE(kill_events.distance, 0))", "kill_events", "kill_events.linked_server_id = linked_servers.id", "MAX(COALESCE(kill_events.distance, 0)) > 0", "value DESC")).bind(limit * 3).all<ServerMetricRow>(),
    db.prepare(
      serverMetricSql(
        "COUNT(player_profiles.id)",
        "player_profiles",
        "player_profiles.linked_server_id = linked_servers.id",
        "COUNT(player_profiles.id) > 0",
        "value DESC",
        "MAX(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at))",
      ),
    ).bind(limit * 3).all<ServerMetricRow>(),
  ]);

  return [
    serverBoard("most_kills", "Most Kills", "Servers ranked by confirmed PvP kill events.", "pvp", "free", kills.results ?? [], "kills", limit),
    serverBoard("server_kd", "Highest Server K/D", "Requires at least 25 confirmed kills to avoid one-kill abuse.", "deathmatch", "free", kd.results ?? [], "ratio", limit),
    serverBoard("longest_kill", "Longest Kill", "Longest confirmed ADM kill distance.", "pvp", "free", longest.results ?? [], "distance", limit),
    serverBoard("unique_players", "Most Unique Players", "Unique imported player profiles per server.", "overall", "free", uniquePlayers.results ?? [], "count", limit),
  ];
}

async function queryBuildServerBoards(env: Env, limit: number): Promise<AdvancedBoard[]> {
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              linked_servers.server_mode,
              linked_servers.server_type,
              linked_servers.map_name,
              linked_servers.mission,
              ${subscriptionPlanSql()} AS plan_key,
              ${subscriptionStatusSql()} AS subscription_status,
              SUM(${buildScoreCaseSql()}) AS value,
              SUM(CASE WHEN build_events.event_type = 'built' THEN 1 ELSE 0 END) AS supporting_a,
              SUM(CASE WHEN ${wallsFenceSql()} THEN 1 ELSE 0 END) AS supporting_b,
              SUM(CASE WHEN ${raidSql()} THEN 1 ELSE 0 END) AS supporting_c,
              MAX(COALESCE(build_events.occurred_at, build_events.created_at)) AS data_freshness
       FROM linked_servers
       LEFT JOIN build_events ON build_events.linked_server_id = linked_servers.id
       WHERE ${publicServerWhereSql()}
       GROUP BY linked_servers.id
       HAVING value > 0
       ORDER BY value DESC, supporting_a DESC, data_freshness DESC
       LIMIT ?`,
    )
    .bind(limit * 3)
    .all<ServerMetricRow>();

  const repairRows = await queryBuildMetric(env, "SUM(CASE WHEN build_events.event_type = 'repaired' THEN 1 ELSE 0 END)", "repairs", limit);
  const raidRows = await queryBuildMetric(env, `SUM(CASE WHEN ${raidSql()} THEN 1 ELSE 0 END)`, "raid", limit);
  const trapsRows = await queryBuildMetric(env, `SUM(CASE WHEN ${trapSql()} THEN 1 ELSE 0 END)`, "traps", limit);

  return [
    serverBoard("build_score", "Highest Build Score", "Construction score from built, placed, repair, and defence actions. Raid/destruction is separate.", "builds", "pro", rows.results ?? [], "score", limit, true),
    serverBoard("repairs", "Most Repairs", "Fence/gate repair and maintenance events.", "pve", "pro", repairRows, "count", limit, true),
    serverBoard("raid_score", "Most Base Raiding / Dismantles", "Dismantle and destruction activity, separate from build score.", "pve", "pro", raidRows, "count", limit, true),
    serverBoard("traps_explosives", "Most Traps & Explosives Placed", "ADM-derived trap/explosive placement events.", "builds", "pro", trapsRows, "count", limit, true),
  ];
}

async function queryHybridServerBoards(env: Env, limit: number): Promise<AdvancedBoard[]> {
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM (
         SELECT linked_servers.id,
                linked_servers.public_slug,
                COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
                linked_servers.server_mode,
                linked_servers.server_type,
                linked_servers.map_name,
                linked_servers.mission,
                ${subscriptionPlanSql()} AS plan_key,
                ${subscriptionStatusSql()} AS subscription_status,
                (
                  (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) * 4
                  + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id) * 1
                  + (SELECT COALESCE(SUM(${buildScoreCaseSql()}), 0) FROM build_events WHERE build_events.linked_server_id = linked_servers.id)
                ) AS value,
                (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS supporting_a,
                (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id) AS supporting_b,
                (SELECT COUNT(*) FROM build_events WHERE build_events.linked_server_id = linked_servers.id) AS supporting_c,
                COALESCE(
                  (SELECT MAX(COALESCE(kill_events.occurred_at, kill_events.created_at)) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id),
                  (SELECT MAX(COALESCE(player_events.occurred_at, player_events.created_at)) FROM player_events WHERE player_events.linked_server_id = linked_servers.id),
                  (SELECT MAX(COALESCE(build_events.occurred_at, build_events.created_at)) FROM build_events WHERE build_events.linked_server_id = linked_servers.id)
                ) AS data_freshness
         FROM linked_servers
         WHERE ${publicServerWhereSql()}
       )
       WHERE value > 0
       ORDER BY value DESC, data_freshness DESC
       LIMIT ?`,
    )
    .bind(limit * 3)
    .all<ServerMetricRow>();

  const eventRows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM (
         SELECT linked_servers.id,
                linked_servers.public_slug,
                COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
                linked_servers.server_mode,
                linked_servers.server_type,
                linked_servers.map_name,
                linked_servers.mission,
                ${subscriptionPlanSql()} AS plan_key,
                ${subscriptionStatusSql()} AS subscription_status,
                ((SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id)
                  + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id)
                  + (SELECT COUNT(*) FROM build_events WHERE build_events.linked_server_id = linked_servers.id)) AS value,
                COALESCE(
                  (SELECT MAX(COALESCE(kill_events.occurred_at, kill_events.created_at)) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id),
                  (SELECT MAX(COALESCE(player_events.occurred_at, player_events.created_at)) FROM player_events WHERE player_events.linked_server_id = linked_servers.id),
                  (SELECT MAX(COALESCE(build_events.occurred_at, build_events.created_at)) FROM build_events WHERE build_events.linked_server_id = linked_servers.id)
                ) AS data_freshness
         FROM linked_servers
         WHERE ${publicServerWhereSql()}
       )
       WHERE value > 0
       ORDER BY value DESC, data_freshness DESC
       LIMIT ?`,
    )
    .bind(limit * 3)
    .all<ServerMetricRow>();

  return [
    serverBoard("balanced_activity_score", "Best Balanced Server Score", "Separate combined score using combat, event, and build activity.", "hybrid", "pro", rows.results ?? [], "score", limit, true),
    serverBoard("events_tracked", "Most Events Tracked", "Canonical imported ADM event rows: kills + player events + build events.", "hybrid", "free", eventRows.results ?? [], "count", limit),
  ];
}

function buildTravelServerBoards(samples: TravelPositionSample[], metaById: Map<string, PublicServerMeta>, limit: number): AdvancedBoard[] {
  const travel = computeTravelStats(samples);
  const rows = travel.servers.map((server) => serverTravelToBoardRow(server, metaById.get(server.linkedServerId))).filter(Boolean) as AdvancedBoardRow[];
  const byTotal = [...rows].sort((a, b) => numberOrZero(b.value) - numberOrZero(a.value)).slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
  const byOnFoot = [...rows].sort((a, b) => numberOrZero(b.supportingStats?.onFootDistanceM) - numberOrZero(a.supportingStats?.onFootDistanceM)).slice(0, limit).map((row, index) => ({
    ...row,
    rank: index + 1,
    value: row.supportingStats?.onFootDistanceM as number,
    displayValue: formatDistanceMeters(numberOrZero(row.supportingStats?.onFootDistanceM)),
  }));
  return [
    {
      metricKey: "most_travelled_server",
      title: "Most Travelled Server",
      description: "Estimated valid ADM movement distance, excluding suspicious jumps.",
      category: "travel",
      packageRequired: "premium",
      rows: byTotal,
      estimated: true,
    },
    {
      metricKey: "most_on_foot_distance",
      title: "Most On-Foot Distance",
      description: "Conservative on-foot movement estimate.",
      category: "travel",
      packageRequired: "premium",
      rows: byOnFoot,
      estimated: true,
    },
  ];
}

function buildExplorationServerBoards(samples: TravelPositionSample[], servers: PublicServerMeta[], limit: number): AdvancedBoard[] {
  const samplesByServer = groupSamplesByServer(samples);
  const rows = servers.map((server) => {
    const exploration = summarizeMapExploration(server.map_name ?? server.mission, samplesByServer.get(server.id) ?? [], { overlayLimit: 0 });
    if (!exploration.supported || exploration.exploredCellsCount <= 0) return null;
    return {
      rank: 0,
      serverId: server.id,
      serverSlug: server.public_slug,
      serverName: server.server_name,
      serverMode: server.server_mode ?? server.server_type,
      mapName: exploration.mapDisplayName,
      value: exploration.explorationPercent,
      displayValue: `${exploration.explorationPercent.toFixed(2)}%`,
      topPlayer: exploration.topExplorerName,
      supportingStats: {
        exploredCells: exploration.exploredCellsCount,
        activeExplorers: exploration.activeExplorersCount,
        boundsConfidence: exploration.boundsConfidence,
      },
      dataFreshness: exploration.lastExplorationUpdateAt,
      estimated: exploration.estimated,
      isPremiumShowcase: getAdvancedShowcaseAccess(server.plan_key, server.subscription_status).globalPremiumShowcase,
    } satisfies AdvancedBoardRow;
  }).filter(Boolean) as AdvancedBoardRow[];

  const ranked = rows.sort((a, b) => numberOrZero(b.value) - numberOrZero(a.value)).slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
  return [{
    metricKey: "map_exploration_percent",
    title: "Best Explorer Server",
    description: "Aggregate map grid coverage from valid ADM position samples. No raw coordinates or routes are exposed.",
    category: "exploration",
    packageRequired: "premium",
    rows: ranked,
    estimated: true,
  }];
}

async function queryBuildMetric(env: Env, expression: string, mode: string, limit: number) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              linked_servers.server_mode,
              linked_servers.server_type,
              linked_servers.map_name,
              linked_servers.mission,
              ${subscriptionPlanSql()} AS plan_key,
              ${subscriptionStatusSql()} AS subscription_status,
              ${expression} AS value,
              MAX(COALESCE(build_events.occurred_at, build_events.created_at)) AS data_freshness
       FROM linked_servers
       LEFT JOIN build_events ON build_events.linked_server_id = linked_servers.id
       WHERE ${publicServerWhereSql()}
       GROUP BY linked_servers.id
       HAVING value > 0
       ORDER BY value DESC, data_freshness DESC
       LIMIT ?`,
    )
    .bind(limit * 3)
    .all<ServerMetricRow & { mode?: string }>();
  return (rows.results ?? []).map((row) => ({ ...row, mode }));
}

async function queryServerPvpPlayers(env: Env, linkedServerId: string, limit: number) {
  const rows = await requireDb(env)
    .prepare(
      `WITH kills AS (
         SELECT COALESCE(killer_id, lower(killer_name)) AS player_key,
                MAX(killer_name) AS player_name,
                COUNT(*) AS kills,
                MAX(COALESCE(distance, 0)) AS longest_kill,
                MAX(COALESCE(occurred_at, created_at)) AS last_event_at
         FROM kill_events
         WHERE linked_server_id = ? AND killer_name IS NOT NULL
         GROUP BY player_key
       ),
       deaths AS (
         SELECT COALESCE(victim_id, lower(victim_name)) AS player_key,
                COUNT(*) AS deaths
         FROM kill_events
         WHERE linked_server_id = ? AND victim_name IS NOT NULL
         GROUP BY player_key
       ),
       weapons AS (
         SELECT player_key, weapon AS favourite_weapon
         FROM (
           SELECT COALESCE(killer_id, lower(killer_name)) AS player_key,
                  weapon,
                  COUNT(*) AS count,
                  ROW_NUMBER() OVER (PARTITION BY COALESCE(killer_id, lower(killer_name)) ORDER BY COUNT(*) DESC, weapon ASC) AS rank
           FROM kill_events
           WHERE linked_server_id = ? AND killer_name IS NOT NULL AND weapon IS NOT NULL
           GROUP BY player_key, weapon
         )
         WHERE rank = 1
       )
       SELECT kills.player_key,
              kills.player_name,
              kills.kills,
              COALESCE(deaths.deaths, 0) AS deaths,
              kills.longest_kill,
              weapons.favourite_weapon,
              0 AS head_hits,
              kills.last_event_at
       FROM kills
       LEFT JOIN deaths ON deaths.player_key = kills.player_key
       LEFT JOIN weapons ON weapons.player_key = kills.player_key
       ORDER BY kills.kills DESC, kills.longest_kill DESC, kills.last_event_at DESC
       LIMIT ?`,
    )
    .bind(linkedServerId, linkedServerId, linkedServerId, safeLimit(limit, 15, 50))
    .all<PlayerMetricRow>();
  return rows.results ?? [];
}

async function queryServerBuildPlayers(env: Env, linkedServerId: string, limit: number) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT COALESCE(player_id, lower(player_name)) AS player_key,
              MAX(player_name) AS player_name,
              SUM(${buildScoreCaseSql()}) AS build_score,
              SUM(CASE WHEN event_type = 'built' THEN 1 ELSE 0 END) AS structures_built,
              SUM(CASE WHEN ${wallsFenceSql()} THEN 1 ELSE 0 END) AS walls_fences,
              SUM(CASE WHEN ${watchtowerSql()} THEN 1 ELSE 0 END) AS watchtowers,
              SUM(CASE WHEN ${gateSql()} THEN 1 ELSE 0 END) AS gates,
              SUM(CASE WHEN ${storageSql()} THEN 1 ELSE 0 END) AS storage_expansion,
              SUM(CASE WHEN event_type = 'repaired' THEN 1 ELSE 0 END) AS repairs,
              SUM(CASE WHEN ${raidSql()} THEN 1 ELSE 0 END) AS raid_score,
              SUM(CASE WHEN ${trapSql()} THEN 1 ELSE 0 END) AS traps_explosives,
              MAX(COALESCE(occurred_at, created_at)) AS last_event_at
       FROM build_events
       WHERE linked_server_id = ?
         AND player_name IS NOT NULL
       GROUP BY player_key
       ORDER BY build_score DESC, structures_built DESC, last_event_at DESC
       LIMIT ?`,
    )
    .bind(linkedServerId, safeLimit(limit, 15, 50))
    .all<PlayerMetricRow>();
  return rows.results ?? [];
}

async function queryServerEventCounts(env: Env, linkedServerId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ?) AS kills,
         (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ?) AS player_events,
         (SELECT COUNT(*) FROM build_events WHERE linked_server_id = ?) AS build_events`,
    )
    .bind(linkedServerId, linkedServerId, linkedServerId)
    .first<{ kills: number | null; player_events: number | null; build_events: number | null }>();
  return {
    eventsTracked: numberOrZero(row?.kills) + numberOrZero(row?.player_events) + numberOrZero(row?.build_events),
  };
}

function serverMetricSql(expression: string, joinTable: string, joinCondition: string, having: string, orderBy: string, freshnessExpression?: string) {
  return `SELECT linked_servers.id,
                 linked_servers.public_slug,
                 COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
                 linked_servers.server_mode,
                 linked_servers.server_type,
                 linked_servers.map_name,
                 linked_servers.mission,
                 ${subscriptionPlanSql()} AS plan_key,
                 ${subscriptionStatusSql()} AS subscription_status,
                 ${expression} AS value,
                 ${freshnessExpression ?? `MAX(COALESCE(${joinTable}.occurred_at, ${joinTable}.created_at))`} AS data_freshness
          FROM linked_servers
          LEFT JOIN ${joinTable} ON ${joinCondition}
          WHERE ${publicServerWhereSql()}
          GROUP BY linked_servers.id
          HAVING ${having}
          ORDER BY ${orderBy}, data_freshness DESC
          LIMIT ?`;
}

function serverBoard(
  metricKey: string,
  title: string,
  description: string,
  category: AdvancedBoardCategory,
  packageRequired: AdvancedBoard["packageRequired"],
  rows: ServerMetricRow[],
  valueType: "count" | "distance" | "score" | "ratio" | "kills",
  limit: number,
  requireProPlus = false,
): AdvancedBoard {
  const ranked = rows
    .filter((row) => !requireProPlus || ["pro", "premium"].includes(getAdvancedShowcaseAccess(row.plan_key, row.subscription_status).effectivePlan))
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      serverId: row.id,
      serverSlug: row.public_slug,
      serverName: row.server_name,
      serverMode: row.server_mode ?? row.server_type,
      mapName: row.map_name ?? row.mission,
      value: numberOrZero(row.value),
      displayValue: formatMetricValue(numberOrZero(row.value), valueType),
      topPlayer: row.top_player ?? null,
      supportingStats: {
        kills: row.supporting_a ?? null,
        deaths: row.supporting_b ?? null,
        secondary: row.supporting_c ?? null,
      },
      dataFreshness: row.data_freshness ?? null,
      isPremiumShowcase: getAdvancedShowcaseAccess(row.plan_key, row.subscription_status).globalPremiumShowcase,
      estimated: false,
    }));

  return { metricKey, title, description, category, packageRequired, rows: ranked };
}

function boardFromPlayerRows(
  metricKey: string,
  title: string,
  description: string,
  category: AdvancedBoardCategory,
  rows: PlayerMetricRow[],
  valueKey: "kills" | "kd" | "longest_kill" | "build_score" | "raid_score",
  locked: boolean,
  access: AdvancedShowcaseAccess,
): AdvancedBoard {
  const mapped = locked ? [] : rows.slice(0, 15).map((row, index) => {
    const kills = numberOrZero(row.kills);
    const deaths = numberOrZero(row.deaths);
    const value = valueKey === "kd"
      ? deaths === 0 ? kills : kills / Math.max(1, deaths)
      : numberOrZero(row[valueKey]);
    return {
      rank: index + 1,
      playerName: row.player_name,
      value: roundNumber(value),
      displayValue: valueKey === "longest_kill" ? formatDistanceMeters(value) : valueKey === "kd" && deaths === 0 && kills > 0 ? "Flawless" : formatMetricValue(value, valueKey === "kd" ? "ratio" : "count"),
      supportingStats: {
        kills,
        deaths,
        favouriteWeapon: row.favourite_weapon ?? null,
        headHits: row.head_hits ?? null,
        structuresBuilt: row.structures_built ?? null,
        wallsFences: row.walls_fences ?? null,
        watchtowers: row.watchtowers ?? null,
        gates: row.gates ?? null,
        storageExpansion: row.storage_expansion ?? null,
        repairs: row.repairs ?? null,
        trapsExplosives: row.traps_explosives ?? null,
      },
      dataFreshness: row.last_event_at ?? null,
    } satisfies AdvancedBoardRow;
  });
  return {
    metricKey,
    title,
    description,
    category,
    packageRequired: "pro",
    rows: mapped,
    locked,
    lockedReason: locked ? lockReason(access) : null,
  };
}

function boardFromTravelPlayers(metricKey: string, title: string, description: string, rows: TravelPlayerStats[], valueKey: keyof TravelPlayerStats, locked: boolean): AdvancedBoard {
  return {
    metricKey,
    title,
    description,
    category: "travel",
    packageRequired: "pro",
    locked,
    lockedReason: locked ? "Pro or Premium is required for server Top 15 travel boards." : null,
    estimated: true,
    rows: locked ? [] : rows.slice(0, 15).map((row, index) => {
      const value = numberOrZero(row[valueKey]);
      return {
        rank: index + 1,
        playerName: row.playerName,
        value,
        displayValue: formatDistanceMeters(value),
        supportingStats: {
          onFootDistanceM: row.onFootDistanceM,
          fastTravelEstimatedDistanceM: row.fastTravelEstimatedDistanceM,
          samples: row.samplesCount,
          suspiciousSegmentsIgnored: row.suspiciousSegmentsCount,
        },
        dataFreshness: row.lastTravelSampleAt,
        estimated: true,
      };
    }),
  };
}

function boardFromExplorerPlayers(metricKey: string, title: string, description: string, rows: AdvancedBoardRow[], locked: boolean): AdvancedBoard {
  return {
    metricKey,
    title,
    description,
    category: "exploration",
    packageRequired: "pro",
    locked,
    lockedReason: locked ? "Pro or Premium is required for server Top 15 explorer boards." : null,
    estimated: true,
    rows: locked ? [] : rows,
  };
}

function buildPlayerExplorerRows(samples: TravelPositionSample[], mapName: unknown): AdvancedBoardRow[] {
  const config = resolveDznMapConfig(mapName);
  if (!config) return [];
  const playerCells = new Map<string, { playerName: string | null; cells: Set<string>; last: string | null }>();
  for (const sample of samples) {
    const cell = summarizeCell(config, sample);
    if (!cell) continue;
    const key = sample.playerKey || sample.playerName || "unknown";
    const stats = playerCells.get(key) ?? { playerName: sample.playerName, cells: new Set<string>(), last: null };
    stats.cells.add(cell);
    stats.last = latestTimestamp([stats.last, sample.occurredAt]);
    playerCells.set(key, stats);
  }
  const total = config.gridSize * config.gridSize;
  return [...playerCells.values()]
    .map((row) => ({
      rank: 0,
      playerName: row.playerName,
      value: total > 0 ? roundNumber((row.cells.size / total) * 100) : 0,
      displayValue: total > 0 ? `${roundNumber((row.cells.size / total) * 100).toFixed(2)}%` : "Unsupported",
      supportingStats: { cells: row.cells.size, boundsConfidence: config.boundsConfidence },
      dataFreshness: row.last,
      estimated: config.boundsConfidence !== "verified",
    }))
    .sort((a, b) => numberOrZero(b.value) - numberOrZero(a.value))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function summarizeCell(config: NonNullable<ReturnType<typeof resolveDznMapConfig>>, sample: TravelPositionSample) {
  if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) return null;
  if (sample.x < config.minX || sample.x > config.maxX || sample.y < config.minY || sample.y > config.maxY) return null;
  const cellX = Math.max(0, Math.min(config.gridSize - 1, Math.floor(((sample.x - config.minX) / (config.maxX - config.minX)) * config.gridSize)));
  const cellY = Math.max(0, Math.min(config.gridSize - 1, Math.floor(((sample.y - config.minY) / (config.maxY - config.minY)) * config.gridSize)));
  return `${cellX}:${cellY}`;
}

function serverTravelToBoardRow(stats: TravelServerStats, meta: PublicServerMeta | undefined): AdvancedBoardRow | null {
  if (!meta || stats.totalValidDistanceM <= 0) return null;
  return {
    rank: 0,
    serverId: meta.id,
    serverSlug: meta.public_slug,
    serverName: meta.server_name,
    serverMode: meta.server_mode ?? meta.server_type,
    mapName: meta.map_name ?? meta.mission,
    value: stats.totalValidDistanceM,
    displayValue: formatDistanceMeters(stats.totalValidDistanceM),
    topPlayer: stats.topExplorerPlayer,
    supportingStats: {
      onFootDistanceM: stats.totalOnFootDistanceM,
      fastTravelEstimatedDistanceM: stats.totalFastTravelEstimatedDistanceM,
      activeExplorers: stats.activeExplorersCount,
      suspiciousSegmentsIgnored: stats.suspiciousSegmentsCount,
    },
    dataFreshness: stats.lastTravelSampleAt,
    isPremiumShowcase: getAdvancedShowcaseAccess(meta.plan_key, meta.subscription_status).globalPremiumShowcase,
    estimated: true,
  };
}

function summarizeBuildRows(rows: PlayerMetricRow[]) {
  return rows.reduce((summary, row) => ({
    buildScore: summary.buildScore + numberOrZero(row.build_score),
    structuresBuilt: summary.structuresBuilt + numberOrZero(row.structures_built),
    raidScore: summary.raidScore + numberOrZero(row.raid_score),
  }), { buildScore: 0, structuresBuilt: 0, raidScore: 0 });
}

function groupSamplesByServer(samples: TravelPositionSample[]) {
  const byServer = new Map<string, TravelPositionSample[]>();
  for (const sample of samples) {
    const rows = byServer.get(sample.linkedServerId) ?? [];
    rows.push(sample);
    byServer.set(sample.linkedServerId, rows);
  }
  return byServer;
}

function publicServerWhereSql() {
  return `${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES)})
    AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
    AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`;
}

function subscriptionPlanSql() {
  return `(SELECT server_subscriptions.plan_key
            FROM server_subscriptions
            WHERE server_subscriptions.guild_id = linked_servers.guild_id
            ORDER BY CASE WHEN lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing') THEN 0 ELSE 1 END,
                     server_subscriptions.updated_at DESC,
                     server_subscriptions.created_at DESC
            LIMIT 1)`;
}

function subscriptionStatusSql() {
  return `(SELECT server_subscriptions.status
            FROM server_subscriptions
            WHERE server_subscriptions.guild_id = linked_servers.guild_id
            ORDER BY CASE WHEN lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing') THEN 0 ELSE 1 END,
                     server_subscriptions.updated_at DESC,
                     server_subscriptions.created_at DESC
            LIMIT 1)`;
}

function buildScoreCaseSql() {
  return `CASE
    WHEN event_type = 'built' AND ${gateSql()} THEN 5
    WHEN event_type = 'built' THEN 5
    WHEN event_type = 'placed' AND ${trapSql()} THEN 3
    WHEN event_type = 'placed' THEN 2
    WHEN event_type = 'repaired' THEN 1
    WHEN event_type = 'mounted' THEN 2
    ELSE 0
  END`;
}

function wallsFenceSql() {
  return `(lower(COALESCE(target_object, '')) LIKE '%fence%'
    OR lower(COALESCE(build_part, '')) LIKE 'wall_%'
    OR lower(COALESCE(placed_class, '')) = 'fencekit'
    OR lower(COALESCE(placed_object, '')) LIKE '%fence%')`;
}

function watchtowerSql() {
  return `(lower(COALESCE(target_object, '')) LIKE '%watchtower%'
    OR lower(COALESCE(build_part, '')) LIKE 'level_%'
    OR lower(COALESCE(placed_class, '')) = 'watchtowerkit'
    OR lower(COALESCE(placed_object, '')) LIKE '%watchtower%')`;
}

function gateSql() {
  return `(lower(COALESCE(target_object, '')) LIKE '%gate%' OR lower(COALESCE(build_part, '')) = 'wall_gate')`;
}

function storageSql() {
  return `(lower(COALESCE(placed_class, '')) LIKE 'woodencrate%'
    OR lower(COALESCE(placed_class, '')) LIKE 'seachest%'
    OR lower(COALESCE(placed_class, '')) LIKE 'barrel%'
    OR lower(COALESCE(placed_class, '')) LIKE '%tent%'
    OR lower(COALESCE(placed_object, '')) LIKE '%crate%'
    OR lower(COALESCE(placed_object, '')) LIKE '%chest%'
    OR lower(COALESCE(placed_object, '')) LIKE '%barrel%'
    OR lower(COALESCE(placed_object, '')) LIKE '%tent%')`;
}

function trapSql() {
  return `(lower(COALESCE(placed_class, '')) LIKE '%trap%'
    OR lower(COALESCE(placed_class, '')) LIKE '%mine%'
    OR lower(COALESCE(placed_class, '')) LIKE '%explosive%'
    OR lower(COALESCE(placed_object, '')) LIKE '%trap%'
    OR lower(COALESCE(placed_object, '')) LIKE '%mine%'
    OR lower(COALESCE(placed_object, '')) LIKE '%explosive%'
    OR lower(COALESCE(placed_object, '')) LIKE '%claymore%')`;
}

function raidSql() {
  return `(event_type IN ('dismantled', 'destroyed'))`;
}

function emptyServerTravelStats(linkedServerId: string): TravelServerStats {
  return {
    linkedServerId,
    totalValidDistanceM: 0,
    totalOnFootDistanceM: 0,
    totalFastTravelEstimatedDistanceM: 0,
    suspiciousDistanceIgnoredM: 0,
    activeExplorersCount: 0,
    longestValidJourneyM: 0,
    topExplorerPlayer: null,
    explorerScore: 0,
    samplesCount: 0,
    suspiciousSegmentsCount: 0,
    lastTravelSampleAt: null,
  };
}

function lockReason(access: AdvancedShowcaseAccess) {
  return access.lockedModules[0]?.reason ?? "A higher DZN package is required for this advanced module.";
}

function formatMetricValue(value: number, type: "count" | "distance" | "score" | "ratio" | "kills") {
  if (type === "distance") return formatDistanceMeters(value);
  if (type === "ratio") return Number.isFinite(value) ? value.toFixed(2) : "Awaiting data";
  return Math.round(value).toLocaleString("en-GB");
}

function formatDistanceMeters(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "Awaiting data";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`;
  return `${Math.round(value)} m`;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)))[0] ?? null;
}

function safeLimit(value: unknown, fallback: number, max: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
}

function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function roundNumber(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
