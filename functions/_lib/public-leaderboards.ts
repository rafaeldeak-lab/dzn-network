import { getRankedBuildServers, type PublicBuildLeaderboardRow } from "./build-events";
import { requireDb } from "./db";
import { calculateServerScore, calculateServerScoreBreakdown, rankServers, type ServerScoreBreakdown } from "./server-ranking";
import type { Env } from "./types";
import {
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  serverLifecycleInSql,
  serverLifecycleSqlExpression,
} from "../../lib/server-lifecycle";

export { calculateServerScore, calculateServerScoreBreakdown };

const MOCK_PLAYER_PREFIXES = ["MockSurvivor", "MockBandit", "MockRunner"];
const PUBLIC_LIFECYCLE_SQL = `${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})`;

export type PublicLeaderboardPlayer = {
  rank: number;
  player_name: string;
  player_id: null;
  server_name: string;
  server_slug: string | null;
  kills: number;
  deaths: number;
  kd: number | null;
  kd_label: string;
  longest_kill: number;
  last_seen: string | null;
  highest_killstreak?: number;
  total_time_alive_seconds?: number;
  headshots?: number;
  favourite_weapon?: string;
  combat_logs_count?: number;
  rage_quits_count?: number;
  spawn_kills_count?: number;
};

export type PublicLeaderboardServer = {
  rank: number;
  server_id: string;
  server_name: string;
  slug: string | null;
  mode: string;
  kills: number;
  deaths: number;
  kd: number | null;
  kd_label: string;
  longest_kill: number;
  unique_players: number;
  joins: number;
  stats_sync_active: boolean;
  score: number;
  score_label: string;
  score_breakdown: ServerScoreBreakdown | null;
};

export type PublicLongestKill = {
  rank: number;
  player_name: string;
  victim_name: string;
  server_name: string;
  server_slug: string | null;
  weapon: string;
  distance: number;
  occurred_at: string | null;
};

export type PublicKillHighlight = Omit<PublicLongestKill, "rank">;

export type { PublicBuildLeaderboardRow };

export type PublicPlayerStatInput = {
  playerName: string | null;
  serverName: string | null;
  serverSlug: string | null;
  kills: number | null;
  deaths: number | null;
  longestKill: number | null;
  lastSeen: string | null;
};

type PublicServerStatRow = {
  server_id: string;
  server_name: string | null;
  slug: string | null;
  mode: string | null;
  kills: number | null;
  deaths: number | null;
  unique_players: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  longest_kill: number | null;
  stats_active: number | null;
  last_activity_at: string | null;
};

type PublicPlayerKillRow = {
  linked_server_id: string;
  player_key: string;
  player_name: string | null;
  server_name: string | null;
  server_slug: string | null;
  kills: number | null;
  longest_kill: number | null;
  last_seen: string | null;
};

type PublicPlayerDeathRow = {
  linked_server_id: string;
  player_key: string;
  player_name: string | null;
  server_name: string | null;
  server_slug: string | null;
  deaths: number | null;
  last_seen: string | null;
};

export type PublicLeaderboardMetric =
  | "total_kills"
  | "deaths"
  | "kd_ratio"
  | "highest_killstreak"
  | "longest_kill_distance"
  | "total_survival_time_alive"
  | "headshots"
  | "favourite_weapon"
  | "combat_logs"
  | "rage_quits"
  | "spawn_kills";

export type PublicTelemetryLeaderboardRow = PublicLeaderboardPlayer & {
  metric: PublicLeaderboardMetric;
  metric_value: number | string | null;
  metric_label: string;
};

export type PublicLeaderboardsOptions = {
  full?: boolean;
  metric?: string | null;
  page?: number;
  pageSize?: number;
};

export type PublicLongestKillRow = {
  player_key?: string | null;
  player_name: string | null;
  victim_name: string | null;
  server_name: string | null;
  server_slug: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at?: string | null;
};

type PublicServerLookupRow = {
  id: string;
  public_slug: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  guild_name: string | null;
};

export async function getPublicLeaderboardsPayload(env: Env, viewerLoggedIn = true, options: PublicLeaderboardsOptions = {}) {
  if (!env.DB) return applyLeaderboardsAccess(emptyPublicLeaderboards(), viewerLoggedIn);

  await ensurePublicLeaderboardSchema(env);
  const requestOptions = normalizePublicLeaderboardOptions(options);
  const limit = requestOptions.full ? requestOptions.pageSize : 10;
  const offset = requestOptions.full ? (requestOptions.page - 1) * requestOptions.pageSize : 0;
  const selectedMetric = normalizeLeaderboardMetric(requestOptions.metric);

  const [topServers, topPlayers, killSummary, buildLeaderboard, playerLeaderboards, selectedMetricLeaderboard] = await Promise.all([
    getRankedPublicServers(env, limit),
    getTopPlayers(env, limit, undefined, offset),
    getLongestKillSummary(env, limit),
    getRankedBuildServers(env, limit),
    getAllTelemetryLeaderboards(env, limit, offset),
    getTelemetryLeaderboard(env, selectedMetric, limit, offset),
  ]);

  return applyLeaderboardsAccess({
    ok: true,
    full: requestOptions.full,
    leaderboard_limit: limit,
    page: requestOptions.full ? requestOptions.page : 1,
    page_size: limit,
    selected_metric: selectedMetric,
    top_servers: topServers,
    top_players: topPlayers,
    best_overall_kill: killSummary.bestOverallKill,
    latest_kill: killSummary.latestKill,
    personal_best_kills: killSummary.personalBestKills,
    longest_kills: killSummary.personalBestKills,
    build_leaderboard: buildLeaderboard,
    player_leaderboards: playerLeaderboards,
    selected_metric_leaderboard: selectedMetricLeaderboard,
    updated_at: new Date().toISOString(),
  }, viewerLoggedIn);
}

export async function getPublicServerLeaderboardPayload(env: Env, options: { serverId?: string | null; slug?: string | null; limit?: number }, viewerLoggedIn = true) {
  if (!env.DB) {
    return applyServerLeaderboardAccess({ ok: true, players: [], updated_at: new Date().toISOString() }, viewerLoggedIn);
  }

  await ensurePublicLeaderboardSchema(env);

  const linkedServerId = options.serverId ?? (options.slug ? await resolvePublicLinkedServerId(env, options.slug) : null);
  if (!linkedServerId) {
    return applyServerLeaderboardAccess({ ok: true, players: [], updated_at: new Date().toISOString() }, viewerLoggedIn);
  }

  // Server profile leaderboards must be scoped by the resolved linked_server_id.
  // Omit linkedServerId only on global leaderboard/homepage surfaces.
  const players = await getTopPlayers(env, options.limit ?? 10, linkedServerId);
  return applyServerLeaderboardAccess({
    ok: true,
    players,
    updated_at: new Date().toISOString(),
  }, viewerLoggedIn);
}

export async function getPublicServerLeaderboardById(env: Env, linkedServerId: string, limit = 5) {
  if (!env.DB) return [];
  await ensurePublicLeaderboardSchema(env);
  return getTopPlayers(env, limit, linkedServerId);
}

async function ensurePublicLeaderboardSchema(env: Env) {
  void env;
}

export async function getRankedPublicServers(env: Env, limit: number) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id AS server_id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS slug,
        COALESCE(NULLIF(linked_servers.server_mode, ''), linked_servers.server_type, 'UNKNOWN') AS mode,
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS kills,
        (
          (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL)
          + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats'))
        ) AS deaths,
        (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id) AS unique_players,
        (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_connected') AS total_joins,
        (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_disconnected') AS total_disconnects,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
        CASE
          WHEN EXISTS (SELECT 1 FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id LIMIT 1)
            OR EXISTS (SELECT 1 FROM player_events WHERE player_events.linked_server_id = linked_servers.id LIMIT 1)
            OR EXISTS (SELECT 1 FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id LIMIT 1)
            OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
            OR EXISTS (
              SELECT 1
              FROM sync_runs
              WHERE sync_runs.linked_server_id = linked_servers.id
                AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              LIMIT 1
            )
          THEN 1 ELSE 0
        END AS stats_active,
        COALESCE(
          server_stats.last_event_at,
          (
            SELECT MAX(COALESCE(kill_events.occurred_at, kill_events.created_at))
            FROM kill_events
            WHERE kill_events.linked_server_id = linked_servers.id
          ),
          linked_servers.updated_at,
          linked_servers.created_at
        ) AS last_activity_at
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 500`,
    )
    .all<PublicServerStatRow>();

  const candidates = (result.results ?? []).map((row) => {
    const kills = numberOrZero(row.kills);
    const deaths = numberOrZero(row.deaths);
    const longestKill = numberOrZero(row.longest_kill);
    const uniquePlayers = numberOrZero(row.unique_players);
    const joins = numberOrZero(row.total_joins);
    const statsSyncActive = Number(row.stats_active) === 1;
    const kd = calculateKd(kills, deaths);
    return {
      id: row.server_id,
      server_id: row.server_id,
      server_name: row.server_name ?? "Unnamed DZN Server",
      slug: row.slug,
      mode: normalizeMode(row.mode),
      kills,
      deaths,
      kd: kd.value,
      kd_label: kd.label,
      longest_kill: longestKill,
      unique_players: uniquePlayers,
      joins,
      statsSyncActive,
      stats_sync_active: statsSyncActive,
      lastActivityAt: row.last_activity_at,
      longestKill,
      uniquePlayers,
    };
  });

  return rankServers(candidates, limit).map((server) => {
    return {
      rank: server.rank,
      server_id: server.server_id,
      server_name: server.server_name,
      slug: server.slug,
      mode: server.mode,
      kills: server.kills,
      deaths: server.deaths,
      kd: server.kd,
      kd_label: server.kd_label,
      longest_kill: server.longest_kill,
      unique_players: server.unique_players,
      joins: server.joins,
      stats_sync_active: server.stats_sync_active,
      score: server.score,
      score_label: server.score_label,
      score_breakdown: server.score_breakdown,
    } satisfies PublicLeaderboardServer;
  });
}

async function getTopPlayers(env: Env, limit: number, linkedServerId?: string, offset = 0) {
  const db = requireDb(env);
  const serverFilter = linkedServerId ? "AND kill_events.linked_server_id = ?" : "";
  const queryLimit = Math.max(1, Math.min(Math.trunc(limit) || 10, 500));
  const queryOffset = Math.max(0, Math.trunc(offset) || 0);

  const killStatement = db.prepare(
    `SELECT
        kill_events.linked_server_id,
        COALESCE(kill_events.killer_id, lower(kill_events.killer_name)) AS player_key,
        MAX(kill_events.killer_name) AS player_name,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS server_slug,
        COUNT(*) AS kills,
        MAX(COALESCE(kill_events.distance, 0)) AS longest_kill,
        MAX(COALESCE(kill_events.occurred_at, kill_events.created_at)) AS last_seen
       FROM kill_events
       INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND kill_events.killer_name IS NOT NULL
         AND ${mockNameFilterSql("kill_events.killer_name")}
         ${serverFilter}
       GROUP BY kill_events.linked_server_id, player_key, linked_servers.public_slug
       ORDER BY kills DESC, longest_kill DESC, last_seen DESC
       LIMIT ? OFFSET ?`,
  );
  const killRows = linkedServerId
    ? await killStatement.bind(linkedServerId, queryLimit, queryOffset).all<PublicPlayerKillRow>()
    : await killStatement.bind(queryLimit, queryOffset).all<PublicPlayerKillRow>();

  const deathStatement = db.prepare(
    `SELECT
        kill_events.linked_server_id,
        COALESCE(kill_events.victim_id, lower(kill_events.victim_name)) AS player_key,
        MAX(kill_events.victim_name) AS player_name,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS server_slug,
        COUNT(*) AS deaths,
        MAX(COALESCE(kill_events.occurred_at, kill_events.created_at)) AS last_seen
       FROM kill_events
       INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND kill_events.victim_name IS NOT NULL
         AND ${mockNameFilterSql("kill_events.victim_name")}
         ${serverFilter}
       GROUP BY kill_events.linked_server_id, player_key, linked_servers.public_slug
       ORDER BY deaths DESC, last_seen DESC
       LIMIT ? OFFSET ?`,
  );
  const deathRows = linkedServerId
    ? await deathStatement.bind(linkedServerId, queryLimit, queryOffset).all<PublicPlayerDeathRow>()
    : await deathStatement.bind(queryLimit, queryOffset).all<PublicPlayerDeathRow>();

  return rankPublicPlayers(mergePlayerRows(killRows.results ?? [], deathRows.results ?? []), queryLimit);
}

async function getLongestKillSummary(env: Env, limit: number) {
  const db = requireDb(env);
  const distanceResult = await db
    .prepare(
      `SELECT
        COALESCE(kill_events.killer_id, lower(kill_events.killer_name)) AS player_key,
        kill_events.killer_name AS player_name,
        kill_events.victim_name,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS server_slug,
        kill_events.weapon,
        kill_events.distance,
        COALESCE(kill_events.occurred_at, kill_events.created_at) AS occurred_at,
        kill_events.created_at
       FROM kill_events
       INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND kill_events.killer_name IS NOT NULL
         AND kill_events.victim_name IS NOT NULL
         AND COALESCE(kill_events.distance, 0) > 0
         AND ${mockNameFilterSql("kill_events.killer_name")}
         AND ${mockNameFilterSql("kill_events.victim_name")}
       ORDER BY kill_events.distance DESC, occurred_at DESC
       LIMIT ?`,
    )
    .bind(Math.max(limit * 8, 100))
    .all<PublicLongestKillRow>();

  const latestKill = await db
    .prepare(
      `SELECT
        COALESCE(kill_events.killer_id, lower(kill_events.killer_name)) AS player_key,
        kill_events.killer_name AS player_name,
        kill_events.victim_name,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS server_slug,
        kill_events.weapon,
        kill_events.distance,
        COALESCE(kill_events.occurred_at, kill_events.created_at) AS occurred_at,
        kill_events.created_at
       FROM kill_events
       INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND kill_events.killer_name IS NOT NULL
         AND kill_events.victim_name IS NOT NULL
         AND ${mockNameFilterSql("kill_events.killer_name")}
         AND ${mockNameFilterSql("kill_events.victim_name")}
       ORDER BY datetime(COALESCE(kill_events.occurred_at, kill_events.created_at)) DESC, kill_events.created_at DESC
       LIMIT 1`,
    )
    .first<PublicLongestKillRow>();

  const rows = distanceResult.results ?? [];
  const bestOverall = rows[0] ? toKillHighlight(rows[0]) : null;
  return {
    bestOverallKill: bestOverall,
    latestKill: latestKill ? toKillHighlight(latestKill) : null,
    personalBestKills: rankLongestKills(rows, limit),
  };
}

function mergePlayerRows(kills: PublicPlayerKillRow[], deaths: PublicPlayerDeathRow[]) {
  const players = new Map<string, PublicPlayerStatInput>();

  function key(row: { linked_server_id: string; player_key: string | null; player_name: string | null }) {
    return `${row.linked_server_id}:${row.player_key || row.player_name?.toLowerCase() || "unknown"}`;
  }

  for (const row of kills) {
    const id = key(row);
    players.set(id, {
      playerName: row.player_name,
      serverName: row.server_name,
      serverSlug: row.server_slug,
      kills: numberOrZero(row.kills),
      deaths: 0,
      longestKill: numberOrZero(row.longest_kill),
      lastSeen: row.last_seen,
    });
  }

  for (const row of deaths) {
    const id = key(row);
    const existing = players.get(id);
    if (existing) {
      existing.deaths = numberOrZero(row.deaths);
      existing.lastSeen = latestDateString(existing.lastSeen, row.last_seen);
    } else {
      players.set(id, {
        playerName: row.player_name,
        serverName: row.server_name,
        serverSlug: row.server_slug,
        kills: 0,
        deaths: numberOrZero(row.deaths),
        longestKill: 0,
        lastSeen: row.last_seen,
      });
    }
  }

  return [...players.values()];
}

export function rankPublicPlayers(players: PublicPlayerStatInput[], limit = 50) {
  return players
    .filter((player) => Boolean(player.playerName) && (numberOrZero(player.kills) > 0 || numberOrZero(player.deaths) > 0))
    .sort((a, b) => {
      const killsDiff = numberOrZero(b.kills) - numberOrZero(a.kills);
      if (killsDiff) return killsDiff;
      const kdDiff = (calculateKd(numberOrZero(b.kills), numberOrZero(b.deaths)).value ?? -1) - (calculateKd(numberOrZero(a.kills), numberOrZero(a.deaths)).value ?? -1);
      if (kdDiff) return kdDiff;
      const longestDiff = numberOrZero(b.longestKill) - numberOrZero(a.longestKill);
      if (longestDiff) return longestDiff;
      return dateValue(b.lastSeen) - dateValue(a.lastSeen);
    })
    .slice(0, limit)
    .map((player, index) => {
      const kills = numberOrZero(player.kills);
      const deaths = numberOrZero(player.deaths);
      const kd = calculateKd(kills, deaths);
      return {
        rank: index + 1,
        player_name: player.playerName ?? "Unknown Player",
        player_id: null,
        server_name: player.serverName ?? "Unnamed DZN Server",
        server_slug: player.serverSlug ?? null,
        kills,
        deaths,
        kd: kd.value,
        kd_label: kd.label,
        longest_kill: roundOne(numberOrZero(player.longestKill)),
        last_seen: player.lastSeen ?? null,
      } satisfies PublicLeaderboardPlayer;
    });
}

export function rankLongestKills(rows: PublicLongestKillRow[], limit = 50) {
  const seenKillers = new Set<string>();
  const personalBests: PublicLongestKillRow[] = [];

  for (const row of rows
    .filter((row) => numberOrZero(row.distance) > 0)
    .sort((a, b) => {
      const distanceDiff = numberOrZero(b.distance) - numberOrZero(a.distance);
      if (distanceDiff) return distanceDiff;
      return dateValue(b.occurred_at) - dateValue(a.occurred_at);
    })) {
    const playerKey = row.player_key || row.player_name?.toLowerCase() || `unknown:${personalBests.length}`;
    if (seenKillers.has(playerKey)) continue;
    seenKillers.add(playerKey);
    personalBests.push(row);
    if (personalBests.length >= limit) break;
  }

  return personalBests
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      player_name: row.player_name ?? "Unknown Player",
      victim_name: row.victim_name ?? "Unknown Player",
      server_name: row.server_name ?? "Unnamed DZN Server",
      server_slug: row.server_slug ?? null,
      weapon: row.weapon ?? "Unknown weapon",
      distance: roundOne(numberOrZero(row.distance)),
      occurred_at: row.occurred_at ?? null,
    } satisfies PublicLongestKill));
}

export function selectLatestKill(rows: PublicLongestKillRow[]) {
  const row = [...rows]
    .filter((item) => item.player_name && item.victim_name)
    .sort((a, b) => dateValue(b.occurred_at ?? b.created_at ?? null) - dateValue(a.occurred_at ?? a.created_at ?? null))[0];
  return row ? toKillHighlight(row) : null;
}

const PUBLIC_LEADERBOARD_METRICS: Record<PublicLeaderboardMetric, {
  orderExpression: string;
  valueExpression: string;
  label: string;
}> = {
  total_kills: {
    orderExpression: "COALESCE(player_profiles.kills, 0)",
    valueExpression: "COALESCE(player_profiles.kills, 0)",
    label: "Total Kills",
  },
  deaths: {
    orderExpression: "COALESCE(player_profiles.deaths, 0)",
    valueExpression: "COALESCE(player_profiles.deaths, 0)",
    label: "Deaths",
  },
  kd_ratio: {
    orderExpression: "CASE WHEN COALESCE(player_profiles.deaths, 0) = 0 THEN COALESCE(player_profiles.kills, 0) ELSE CAST(COALESCE(player_profiles.kills, 0) AS REAL) / COALESCE(player_profiles.deaths, 1) END",
    valueExpression: "CASE WHEN COALESCE(player_profiles.deaths, 0) = 0 THEN COALESCE(player_profiles.kills, 0) ELSE CAST(COALESCE(player_profiles.kills, 0) AS REAL) / COALESCE(player_profiles.deaths, 1) END",
    label: "K/D Ratio",
  },
  highest_killstreak: {
    orderExpression: "COALESCE(player_profiles.highest_killstreak, 0)",
    valueExpression: "COALESCE(player_profiles.highest_killstreak, 0)",
    label: "Highest Killstreak",
  },
  longest_kill_distance: {
    orderExpression: "COALESCE(player_profiles.longest_kill_distance, 0)",
    valueExpression: "COALESCE(player_profiles.longest_kill_distance, 0)",
    label: "Longest Kill",
  },
  total_survival_time_alive: {
    orderExpression: "COALESCE(player_profiles.total_time_alive_seconds, 0)",
    valueExpression: "COALESCE(player_profiles.total_time_alive_seconds, 0)",
    label: "Survival Time",
  },
  headshots: {
    orderExpression: "COALESCE(player_profiles.headshots, 0)",
    valueExpression: "COALESCE(player_profiles.headshots, 0)",
    label: "Headshots",
  },
  favourite_weapon: {
    orderExpression: "COALESCE(player_profiles.kills, 0)",
    valueExpression: "COALESCE(NULLIF(player_profiles.favourite_weapon, ''), 'Unknown')",
    label: "Favourite Weapon",
  },
  combat_logs: {
    orderExpression: "COALESCE(player_profiles.combat_logs_count, 0)",
    valueExpression: "COALESCE(player_profiles.combat_logs_count, 0)",
    label: "Combat Logs",
  },
  rage_quits: {
    orderExpression: "COALESCE(player_profiles.rage_quits_count, 0)",
    valueExpression: "COALESCE(player_profiles.rage_quits_count, 0)",
    label: "Rage Quits",
  },
  spawn_kills: {
    orderExpression: "COALESCE(player_profiles.spawn_kills_count, 0)",
    valueExpression: "COALESCE(player_profiles.spawn_kills_count, 0)",
    label: "Spawn Kills",
  },
};

export function normalizeLeaderboardMetric(value: unknown): PublicLeaderboardMetric {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[-\s]+/g, "_") : "";
  if (text === "kills") return "total_kills";
  if (text === "kd" || text === "k_d" || text === "kdr") return "kd_ratio";
  if (text === "killstreak") return "highest_killstreak";
  if (text === "longest_kill") return "longest_kill_distance";
  if (text === "survival_time" || text === "time_alive") return "total_survival_time_alive";
  if (text === "favorite_weapon") return "favourite_weapon";
  if (text === "combat_logging") return "combat_logs";
  if (text === "rage_quitting") return "rage_quits";
  if (text === "spawn_killing") return "spawn_kills";
  return isPublicLeaderboardMetric(text) ? text : "total_kills";
}

export function normalizePublicLeaderboardOptions(options: PublicLeaderboardsOptions = {}) {
  const full = options.full === true;
  const page = full ? Math.max(1, Math.trunc(Number(options.page ?? 1)) || 1) : 1;
  const pageSize = full
    ? Math.max(1, Math.min(Math.trunc(Number(options.pageSize ?? 100)) || 100, 500))
    : 10;
  return {
    full,
    metric: normalizeLeaderboardMetric(options.metric),
    page,
    pageSize,
  };
}

async function getAllTelemetryLeaderboards(env: Env, limit: number, offset = 0) {
  const entries = await Promise.all(
    (Object.keys(PUBLIC_LEADERBOARD_METRICS) as PublicLeaderboardMetric[])
      .map(async (metric) => [metric, await getTelemetryLeaderboard(env, metric, limit, offset)] as const),
  );
  return Object.fromEntries(entries) as Record<PublicLeaderboardMetric, PublicTelemetryLeaderboardRow[]>;
}

async function getTelemetryLeaderboard(env: Env, metric: PublicLeaderboardMetric, limit: number, offset = 0) {
  const db = requireDb(env);
  const mapping = PUBLIC_LEADERBOARD_METRICS[metric];
  const queryLimit = Math.max(1, Math.min(Math.trunc(limit) || 10, 500));
  const queryOffset = Math.max(0, Math.trunc(offset) || 0);
  const result = await db
    .prepare(
      `SELECT
        player_profiles.player_name,
        player_profiles.player_id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS server_slug,
        COALESCE(player_profiles.kills, 0) AS kills,
        COALESCE(player_profiles.deaths, 0) AS deaths,
        COALESCE(player_profiles.longest_kill_distance, 0) AS longest_kill,
        COALESCE(player_profiles.highest_killstreak, 0) AS highest_killstreak,
        COALESCE(player_profiles.total_time_alive_seconds, 0) AS total_time_alive_seconds,
        COALESCE(player_profiles.headshots, 0) AS headshots,
        COALESCE(NULLIF(player_profiles.favourite_weapon, ''), 'Unknown') AS favourite_weapon,
        COALESCE(player_profiles.combat_logs_count, 0) AS combat_logs_count,
        COALESCE(player_profiles.rage_quits_count, 0) AS rage_quits_count,
        COALESCE(player_profiles.spawn_kills_count, 0) AS spawn_kills_count,
        player_profiles.last_seen_at AS last_seen,
        ${mapping.valueExpression} AS metric_value
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND player_profiles.player_name IS NOT NULL
         AND ${mockNameFilterSql("player_profiles.player_name")}
       ORDER BY ${mapping.orderExpression} DESC, COALESCE(player_profiles.kills, 0) DESC, datetime(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(queryLimit, queryOffset)
    .all<{
      player_name: string | null;
      player_id: string | null;
      server_name: string | null;
      server_slug: string | null;
      kills: number | null;
      deaths: number | null;
      longest_kill: number | null;
      highest_killstreak: number | null;
      total_time_alive_seconds: number | null;
      headshots: number | null;
      favourite_weapon: string | null;
      combat_logs_count: number | null;
      rage_quits_count: number | null;
      spawn_kills_count: number | null;
      last_seen: string | null;
      metric_value: number | string | null;
    }>();

  return (result.results ?? []).map((row, index) => {
    const kills = numberOrZero(row.kills);
    const deaths = numberOrZero(row.deaths);
    const kd = calculateKd(kills, deaths);
    const metricValue = normalizeMetricValue(metric, row.metric_value);
    return {
      rank: queryOffset + index + 1,
      player_name: row.player_name ?? "Unknown Player",
      player_id: null,
      server_name: row.server_name ?? "Unnamed DZN Server",
      server_slug: row.server_slug ?? null,
      kills,
      deaths,
      kd: kd.value,
      kd_label: kd.label,
      longest_kill: roundOne(numberOrZero(row.longest_kill)),
      last_seen: row.last_seen ?? null,
      highest_killstreak: numberOrZero(row.highest_killstreak),
      total_time_alive_seconds: numberOrZero(row.total_time_alive_seconds),
      headshots: numberOrZero(row.headshots),
      favourite_weapon: row.favourite_weapon ?? "Unknown",
      combat_logs_count: numberOrZero(row.combat_logs_count),
      rage_quits_count: numberOrZero(row.rage_quits_count),
      spawn_kills_count: numberOrZero(row.spawn_kills_count),
      metric,
      metric_value: metricValue,
      metric_label: formatMetricLabel(metric, metricValue),
    } satisfies PublicTelemetryLeaderboardRow;
  });
}

function normalizeMetricValue(metric: PublicLeaderboardMetric, value: number | string | null) {
  if (metric === "favourite_weapon") return typeof value === "string" && value.trim() ? value.trim() : "Unknown";
  if (metric === "kd_ratio") return roundTwo(numberOrZero(value));
  if (metric === "longest_kill_distance") return roundOne(numberOrZero(value));
  return numberOrZero(value);
}

function formatMetricLabel(metric: PublicLeaderboardMetric, value: number | string | null) {
  if (metric === "favourite_weapon") return String(value ?? "Unknown");
  if (metric === "kd_ratio") return numberOrZero(value).toFixed(2);
  if (metric === "longest_kill_distance") return `${roundOne(numberOrZero(value)).toFixed(1)}m`;
  if (metric === "total_survival_time_alive") return formatDuration(numberOrZero(value));
  return String(numberOrZero(value));
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function isPublicLeaderboardMetric(value: string): value is PublicLeaderboardMetric {
  return Object.prototype.hasOwnProperty.call(PUBLIC_LEADERBOARD_METRICS, value);
}

function toKillHighlight(row: PublicLongestKillRow): PublicKillHighlight {
  return {
    player_name: row.player_name ?? "Unknown Player",
    victim_name: row.victim_name ?? "Unknown Player",
    server_name: row.server_name ?? "Unnamed DZN Server",
    server_slug: row.server_slug ?? null,
    weapon: row.weapon ?? "Unknown weapon",
    distance: roundOne(numberOrZero(row.distance)),
    occurred_at: row.occurred_at ?? row.created_at ?? null,
  };
}

export function calculateKd(kills: number, deaths: number) {
  const safeKills = numberOrZero(kills);
  const safeDeaths = numberOrZero(deaths);
  if (safeKills === 0 && safeDeaths === 0) return { value: null, label: "Awaiting data" };
  if (safeKills > 0 && safeDeaths === 0) return { value: safeKills, label: "Flawless" };
  const value = safeDeaths > 0 ? roundTwo(safeKills / safeDeaths) : 0;
  return { value, label: value.toFixed(2) };
}

async function resolvePublicLinkedServerId(env: Env, slug: string) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.nitrado_service_name,
        discord_guilds.name AS guild_name
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${PUBLIC_LIFECYCLE_SQL}
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 500`,
    )
    .all<PublicServerLookupRow>();

  const normalized = sanitizeSlug(slug);
  if (!normalized) return null;

  const exactPublicSlugMatch = (rows.results ?? []).find((row) => sanitizeSlug(row.public_slug) === normalized);
  if (exactPublicSlugMatch) return exactPublicSlugMatch.id;

  for (const row of rows.results ?? []) {
    if (publicSlugCandidates(row.public_slug, row.server_name, row.nitrado_service_name, row.guild_name).has(normalized)) {
      return row.id;
    }
  }

  return null;
}

function publicSlugCandidates(...values: Array<string | null>) {
  const candidates = new Set<string>();
  for (const value of values) {
    for (const candidate of slugCandidates(value)) candidates.add(candidate);
  }
  return candidates;
}

function slugCandidates(value: string | null) {
  if (!value) return [];
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "").slice(0, 90);
  const hyphenated = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  const preservedHyphen = normalized.replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return Array.from(new Set([compact, hyphenated, preservedHyphen].filter(Boolean)));
}

function sanitizeSlug(value: string | null) {
  if (!value) return null;
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return slug || null;
}

function normalizeMode(value: string | null) {
  const mode = (value ?? "UNKNOWN").replace(/_/g, " ").trim().toUpperCase();
  return mode || "UNKNOWN";
}

function mockNameFilterSql(column: string) {
  return `(${column} IS NULL OR (${MOCK_PLAYER_PREFIXES.map((prefix) => `${column} NOT LIKE '${prefix}%'`).join(" AND ")}))`;
}

function latestDateString(a: string | null, b: string | null) {
  return dateValue(a) >= dateValue(b) ? a : b;
}

function dateValue(value: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function roundOne(value: number) {
  return Math.round(numberOrZero(value) * 10) / 10;
}

function roundTwo(value: number) {
  return Math.round(numberOrZero(value) * 100) / 100;
}

export function applyLeaderboardsAccess<T extends {
  top_servers: PublicLeaderboardServer[];
  top_players: PublicLeaderboardPlayer[];
  best_overall_kill: PublicKillHighlight | null;
  latest_kill: PublicKillHighlight | null;
  personal_best_kills: PublicLongestKill[];
  longest_kills: PublicLongestKill[];
  build_leaderboard: PublicBuildLeaderboardRow[];
  player_leaderboards?: Record<PublicLeaderboardMetric, PublicTelemetryLeaderboardRow[]>;
  selected_metric_leaderboard?: PublicTelemetryLeaderboardRow[];
}>(payload: T, viewerLoggedIn: boolean): T & {
  access_level: "full" | "preview";
  is_locked: boolean;
  locked_reason: string | null;
} {
  if (viewerLoggedIn) {
    return {
      ...payload,
      access_level: "full",
      is_locked: false,
      locked_reason: null,
    };
  }

  return {
    ...payload,
    top_servers: payload.top_servers.slice(0, 3).map((server) => ({
      ...server,
      score_breakdown: null,
    })),
    top_players: [],
    best_overall_kill: null,
    latest_kill: null,
    personal_best_kills: [],
    longest_kills: [],
    build_leaderboard: [],
    player_leaderboards: emptyTelemetryLeaderboards(),
    selected_metric_leaderboard: [],
    access_level: "preview",
    is_locked: true,
    locked_reason: "Log in with Discord to unlock full leaderboards.",
  };
}

export function applyServerLeaderboardAccess<T extends { players: PublicLeaderboardPlayer[] }>(payload: T, viewerLoggedIn: boolean): T & {
  access_level: "full" | "preview";
  is_locked: boolean;
  locked_reason: string | null;
} {
  if (viewerLoggedIn) {
    return {
      ...payload,
      access_level: "full",
      is_locked: false,
      locked_reason: null,
    };
  }

  return {
    ...payload,
    players: [],
    access_level: "preview",
    is_locked: true,
    locked_reason: "Log in with Discord to unlock this server leaderboard.",
  };
}

export function emptyPublicLeaderboards(options: PublicLeaderboardsOptions = {}) {
  const requestOptions = normalizePublicLeaderboardOptions(options);
  const limit = requestOptions.full ? requestOptions.pageSize : 10;
  return {
    ok: true,
    full: requestOptions.full,
    leaderboard_limit: limit,
    page: requestOptions.full ? requestOptions.page : 1,
    page_size: limit,
    selected_metric: requestOptions.metric,
    top_servers: [],
    top_players: [],
    best_overall_kill: null,
    latest_kill: null,
    personal_best_kills: [],
    longest_kills: [],
    build_leaderboard: [],
    player_leaderboards: emptyTelemetryLeaderboards(),
    selected_metric_leaderboard: [],
    updated_at: new Date().toISOString(),
  };
}

function emptyTelemetryLeaderboards() {
  const empty = {} as Record<PublicLeaderboardMetric, PublicTelemetryLeaderboardRow[]>;
  for (const metric of Object.keys(PUBLIC_LEADERBOARD_METRICS) as PublicLeaderboardMetric[]) {
    empty[metric] = [];
  }
  return empty;
}
