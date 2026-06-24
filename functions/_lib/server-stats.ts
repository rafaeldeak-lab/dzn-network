import { requireDb } from "./db";
import {
  readPublicApiCache,
  writePublicApiCache,
} from "./public-api-cache";
import { calculateServerScoreBreakdown, type ServerScoreBreakdown } from "./server-ranking";
import type { Env } from "./types";

const PUBLIC_HOME_STATS_ADM_SNAPSHOT_KEYS = [
  { key: "home-stats:preview", accessLevel: "preview" as const },
  { key: "home-stats:full", accessLevel: "full" as const },
] as const;

const DEATH_EVENT_TYPES = [
  "player_suicide",
  "player_killed_environment",
  "player_died_stats",
] as const;

const MOCK_PLAYER_FILTER = `
  LOWER(COALESCE(player_name, '')) NOT LIKE 'player%'
  AND LOWER(COALESCE(player_name, '')) NOT LIKE 'survivor%'
  AND LOWER(COALESCE(player_name, '')) NOT LIKE 'infected%'
`;

const MOCK_KILL_FILTER = `
  LOWER(COALESCE(killer_name, '')) NOT LIKE 'player%'
  AND LOWER(COALESCE(killer_name, '')) NOT LIKE 'survivor%'
  AND LOWER(COALESCE(killer_name, '')) NOT LIKE 'infected%'
`;

const PUBLIC_SERVER_SCOPE = `
  SELECT id
  FROM linked_servers
  WHERE lower(status) = 'live'
    AND lower(COALESCE(listing_visibility, 'public')) != 'hidden'
    AND (
      merged_into_server_id IS NULL
      OR TRIM(COALESCE(merged_into_server_id, '')) = ''
    )
`;

export type CanonicalServerStats = {
  kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  uniquePlayers: number;
  longestKill: number;
  totalEventsTracked: number;
  lastEventAt: string | null;
};

export type CanonicalServerRank = {
  score: number;
  scoreLabel: string;
  scoreBreakdown: ServerScoreBreakdown;
  rank: number | null;
  statsSyncActive: boolean;
};

export type CanonicalServerLiveStats = CanonicalServerStats & {
  statsSyncActive: boolean;
};

export type PublicAdmStatsSummary = {
  killsTracked: number;
  deathsTracked: number;
  joinsTracked: number;
  disconnectsTracked: number;
  uniquePlayersTracked: number;
  longestKill: number;
  totalEventsTracked: number;
  latestEventAt: string | null;
};

type HomeStatsLike = Record<string, unknown> & {
  data?: Record<string, unknown>;
  totals?: Record<string, unknown> | null;
  network_pulse?: Record<string, unknown>;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function countBuildEventsForServer(
  db: D1Database,
  linkedServerId: string,
): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT COUNT(*) AS total FROM build_events WHERE linked_server_id = ?")
      .bind(linkedServerId)
      .first<{ total: number | null }>();
    return toNumber(row?.total);
  } catch {
    return 0;
  }
}

async function latestBuildEventAtForServer(
  db: D1Database,
  linkedServerId: string,
): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT MAX(COALESCE(occurred_at, created_at)) AS latest_at FROM build_events WHERE linked_server_id = ?")
      .bind(linkedServerId)
      .first<{ latest_at: string | null }>();
    return row?.latest_at ?? null;
  } catch {
    return null;
  }
}

async function countPublicBuildEvents(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM build_events
        WHERE linked_server_id IN (${PUBLIC_SERVER_SCOPE})
      `,
      )
      .first<{ total: number | null }>();
    return toNumber(row?.total);
  } catch {
    return 0;
  }
}

async function latestPublicBuildEventAt(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `
        SELECT MAX(COALESCE(occurred_at, created_at)) AS latest_at
        FROM build_events
        WHERE linked_server_id IN (${PUBLIC_SERVER_SCOPE})
      `,
      )
      .first<{ latest_at: string | null }>();
    return row?.latest_at ?? null;
  } catch {
    return null;
  }
}

export async function getCanonicalServerStats(
  db: D1Database,
  linkedServerId: string,
): Promise<CanonicalServerStats> {
  const [killStats, playerStats, uniqueStats, buildEvents, latestKillAt, latestPlayerEventAt, latestBuildAt] =
    await Promise.all([
      db
        .prepare(
          `
          SELECT
            COUNT(*) AS kills,
            SUM(CASE WHEN victim_name IS NOT NULL THEN 1 ELSE 0 END) AS kill_deaths,
            MAX(COALESCE(distance, 0)) AS longest_kill
          FROM kill_events
          WHERE linked_server_id = ?
        `,
        )
        .bind(linkedServerId)
        .first<{ kills: number | null; kill_deaths: number | null; longest_kill: number | null }>(),
      db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN event_type = 'player_connected' THEN 1 ELSE 0 END) AS joins,
            SUM(CASE WHEN event_type = 'player_disconnected' THEN 1 ELSE 0 END) AS disconnects,
            SUM(CASE WHEN event_type IN (${DEATH_EVENT_TYPES.map(() => "?").join(", ")}) THEN 1 ELSE 0 END) AS other_deaths,
            COUNT(*) AS total
          FROM player_events
          WHERE linked_server_id = ?
        `,
        )
        .bind(...DEATH_EVENT_TYPES, linkedServerId)
        .first<{ joins: number | null; disconnects: number | null; other_deaths: number | null; total: number | null }>(),
      db
        .prepare("SELECT COUNT(*) AS total FROM player_profiles WHERE linked_server_id = ?")
        .bind(linkedServerId)
        .first<{ total: number | null }>(),
      countBuildEventsForServer(db, linkedServerId),
      db
        .prepare("SELECT MAX(COALESCE(occurred_at, created_at)) AS latest_at FROM kill_events WHERE linked_server_id = ?")
        .bind(linkedServerId)
        .first<{ latest_at: string | null }>(),
      db
        .prepare("SELECT MAX(COALESCE(occurred_at, created_at)) AS latest_at FROM player_events WHERE linked_server_id = ?")
        .bind(linkedServerId)
        .first<{ latest_at: string | null }>(),
      latestBuildEventAtForServer(db, linkedServerId),
    ]);

  const kills = toNumber(killStats?.kills);
  const playerEvents = toNumber(playerStats?.total);
  const latestEventAt = [latestKillAt?.latest_at, latestPlayerEventAt?.latest_at, latestBuildAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    kills,
    deaths: toNumber(killStats?.kill_deaths) + toNumber(playerStats?.other_deaths),
    joins: toNumber(playerStats?.joins),
    disconnects: toNumber(playerStats?.disconnects),
    uniquePlayers: toNumber(uniqueStats?.total),
    longestKill: toNumber(killStats?.longest_kill),
    totalEventsTracked: kills + playerEvents + buildEvents,
    lastEventAt: latestEventAt,
  };
}

export async function getCanonicalServerLiveStats(
  db: D1Database,
  linkedServerId: string,
): Promise<CanonicalServerLiveStats> {
  const row = await queryCanonicalServerLiveStats(db, linkedServerId, true).catch(() =>
    queryCanonicalServerLiveStats(db, linkedServerId, false),
  );

  return canonicalLiveStatsFromRow(row);
}

async function queryCanonicalServerLiveStats(db: D1Database, linkedServerId: string, includeBuildEvents: boolean) {
  const buildStatsCte = includeBuildEvents
    ? `build_stats AS (
        SELECT
          COUNT(*) AS build_events,
          MAX(COALESCE(occurred_at, created_at)) AS latest_build_at
        FROM build_events
        WHERE linked_server_id = ?
      )`
    : `build_stats AS (
        SELECT
          0 AS build_events,
          NULL AS latest_build_at
      )`;

  return db
    .prepare(
      `
      WITH
      kill_stats AS (
        SELECT
          COUNT(*) AS kills,
          SUM(CASE WHEN victim_name IS NOT NULL THEN 1 ELSE 0 END) AS kill_deaths,
          MAX(COALESCE(distance, 0)) AS longest_kill,
          MAX(COALESCE(occurred_at, created_at)) AS latest_kill_at
        FROM kill_events
        WHERE linked_server_id = ?
      ),
      player_event_stats AS (
        SELECT
          SUM(CASE WHEN event_type = 'player_connected' THEN 1 ELSE 0 END) AS joins,
          SUM(CASE WHEN event_type = 'player_disconnected' THEN 1 ELSE 0 END) AS disconnects,
          SUM(CASE WHEN event_type IN (${DEATH_EVENT_TYPES.map(() => "?").join(", ")}) THEN 1 ELSE 0 END) AS player_deaths,
          COUNT(*) AS player_events,
          MAX(COALESCE(occurred_at, created_at)) AS latest_player_event_at
        FROM player_events
        WHERE linked_server_id = ?
      ),
      profile_stats AS (
        SELECT COUNT(*) AS unique_players
        FROM player_profiles
        WHERE linked_server_id = ?
      ),
      ${buildStatsCte}
      SELECT
        COALESCE(kill_stats.kills, 0) AS kills,
        COALESCE(kill_stats.kill_deaths, 0) + COALESCE(player_event_stats.player_deaths, 0) AS deaths,
        COALESCE(player_event_stats.joins, 0) AS joins,
        COALESCE(player_event_stats.disconnects, 0) AS disconnects,
        COALESCE(player_event_stats.player_events, 0) AS player_events,
        COALESCE(profile_stats.unique_players, 0) AS unique_players,
        COALESCE(kill_stats.longest_kill, 0) AS longest_kill,
        kill_stats.latest_kill_at AS latest_kill_at,
        player_event_stats.latest_player_event_at AS latest_player_event_at,
        COALESCE(build_stats.build_events, 0) AS build_events,
        build_stats.latest_build_at AS latest_build_at,
        CASE
          WHEN COALESCE(kill_stats.kills, 0) > 0
            OR COALESCE(player_event_stats.player_events, 0) > 0
            OR COALESCE(profile_stats.unique_players, 0) > 0
            OR EXISTS (
              SELECT 1
              FROM adm_sync_state
              WHERE adm_sync_state.linked_server_id = ?
                AND lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              LIMIT 1
            )
            OR EXISTS (
              SELECT 1
              FROM sync_runs
              WHERE sync_runs.linked_server_id = ?
                AND lower(COALESCE(sync_runs.status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              LIMIT 1
            )
          THEN 1 ELSE 0
        END AS stats_active
      FROM kill_stats
      CROSS JOIN player_event_stats
      CROSS JOIN profile_stats
      CROSS JOIN build_stats
      `,
    )
    .bind(
      linkedServerId,
      ...DEATH_EVENT_TYPES,
      linkedServerId,
      linkedServerId,
      ...(includeBuildEvents ? [linkedServerId] : []),
      linkedServerId,
      linkedServerId,
    )
    .first<{
      kills: number | null;
      deaths: number | null;
      joins: number | null;
      disconnects: number | null;
      player_events: number | null;
      unique_players: number | null;
      longest_kill: number | null;
      latest_kill_at: string | null;
      latest_player_event_at: string | null;
      build_events: number | null;
      latest_build_at: string | null;
      stats_active: number | null;
    }>();
}

function canonicalLiveStatsFromRow(row: Awaited<ReturnType<typeof queryCanonicalServerLiveStats>>): CanonicalServerLiveStats {
  const kills = toNumber(row?.kills);
  const playerEvents = toNumber(row?.player_events);
  const buildEvents = toNumber(row?.build_events);
  const latestEventAt = [row?.latest_kill_at, row?.latest_player_event_at, row?.latest_build_at]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    kills,
    deaths: toNumber(row?.deaths),
    joins: toNumber(row?.joins),
    disconnects: toNumber(row?.disconnects),
    uniquePlayers: toNumber(row?.unique_players),
    longestKill: toNumber(row?.longest_kill),
    totalEventsTracked: kills + playerEvents + buildEvents,
    lastEventAt: latestEventAt,
    statsSyncActive: Number(row?.stats_active ?? 0) === 1,
  };
}

export async function getCanonicalServerRank(
  db: D1Database,
  linkedServerId: string,
  stats: CanonicalServerStats,
): Promise<CanonicalServerRank> {
  const statsSyncActive = await hasCanonicalServerActivity(db, linkedServerId).catch(() =>
    stats.kills > 0 || stats.joins > 0 || stats.uniquePlayers > 0 || Boolean(stats.lastEventAt),
  );
  const scoreBreakdown = calculateServerScoreBreakdown({
    kills: stats.kills,
    deaths: stats.deaths,
    joins: stats.joins,
    uniquePlayers: stats.uniquePlayers,
    longestKill: stats.longestKill,
    statsSyncActive,
  });
  const rank = await getCanonicalServerRankNumber(db, linkedServerId).catch(() => null);

  return {
    score: scoreBreakdown.final_score,
    scoreLabel: String(scoreBreakdown.final_score),
    scoreBreakdown,
    rank,
    statsSyncActive,
  };
}

async function hasCanonicalServerActivity(db: D1Database, linkedServerId: string) {
  const row = await db
    .prepare(
      `
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM kill_events WHERE linked_server_id = ? LIMIT 1)
            OR EXISTS (SELECT 1 FROM player_events WHERE linked_server_id = ? LIMIT 1)
            OR EXISTS (SELECT 1 FROM player_profiles WHERE linked_server_id = ? LIMIT 1)
            OR EXISTS (
              SELECT 1
              FROM adm_sync_state
              WHERE linked_server_id = ?
                AND lower(COALESCE(last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              LIMIT 1
            )
            OR EXISTS (
              SELECT 1
              FROM sync_runs
              WHERE linked_server_id = ?
                AND lower(COALESCE(status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              LIMIT 1
            )
          THEN 1 ELSE 0
        END AS active
      `,
    )
    .bind(linkedServerId, linkedServerId, linkedServerId, linkedServerId, linkedServerId)
    .first<{ active: number | null }>();

  return Number(row?.active ?? 0) === 1;
}

async function getCanonicalServerRankNumber(db: D1Database, linkedServerId: string) {
  const row = await db
    .prepare(
      `
      WITH server_scope AS (
        SELECT
          linked_servers.id,
          (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS kills,
          (
            (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL)
            + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats'))
          ) AS deaths,
          (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id) AS unique_players,
          (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_connected') AS joins,
          COALESCE((SELECT MAX(COALESCE(distance, 0)) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
          CASE
            WHEN EXISTS (SELECT 1 FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id LIMIT 1)
              OR EXISTS (SELECT 1 FROM player_events WHERE player_events.linked_server_id = linked_servers.id LIMIT 1)
              OR EXISTS (SELECT 1 FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id LIMIT 1)
              OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
              OR EXISTS (
                SELECT 1
                FROM sync_runs
                WHERE sync_runs.linked_server_id = linked_servers.id
                  AND lower(COALESCE(sync_runs.status, '')) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
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
          AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
      ),
      scored AS (
        SELECT
          *,
          MAX(0, (kills * 10) + (unique_players * 5) + (joins * 2) + ROUND(longest_kill) + CASE WHEN stats_active = 1 THEN 25 ELSE 0 END - (deaths * 2)) AS score,
          CASE
            WHEN kills > 0 OR deaths > 0 OR unique_players > 0 OR joins > 0 OR longest_kill > 0 OR stats_active = 1
            THEN 1 ELSE 0
          END AS has_score_data,
          CASE
            WHEN kills = 0 AND deaths = 0 THEN -1
            WHEN kills > 0 AND deaths = 0 THEN kills
            WHEN deaths > 0 THEN CAST(kills AS REAL) / deaths
            ELSE 0
          END AS kd_rank,
          COALESCE(julianday(last_activity_at), 0) AS activity_rank
        FROM server_scope
      ),
      target AS (
        SELECT *
        FROM scored
        WHERE id = ?
        LIMIT 1
      )
      SELECT
        1 + (
          SELECT COUNT(*)
          FROM scored other
          JOIN target ON 1 = 1
          WHERE other.id != target.id
            AND (
              other.has_score_data > target.has_score_data
              OR (other.has_score_data = target.has_score_data AND other.score > target.score)
              OR (other.has_score_data = target.has_score_data AND other.score = target.score AND other.kills > target.kills)
              OR (other.has_score_data = target.has_score_data AND other.score = target.score AND other.kills = target.kills AND other.kd_rank > target.kd_rank)
              OR (other.has_score_data = target.has_score_data AND other.score = target.score AND other.kills = target.kills AND other.kd_rank = target.kd_rank AND other.longest_kill > target.longest_kill)
              OR (other.has_score_data = target.has_score_data AND other.score = target.score AND other.kills = target.kills AND other.kd_rank = target.kd_rank AND other.longest_kill = target.longest_kill AND other.unique_players > target.unique_players)
              OR (other.has_score_data = target.has_score_data AND other.score = target.score AND other.kills = target.kills AND other.kd_rank = target.kd_rank AND other.longest_kill = target.longest_kill AND other.unique_players = target.unique_players AND other.activity_rank > target.activity_rank)
            )
        ) AS rank
      FROM target
      `,
    )
    .bind(linkedServerId)
    .first<{ rank: number | null }>();

  return row?.rank ?? null;
}

export async function getPublicAdmStatsSummary(db: D1Database): Promise<PublicAdmStatsSummary> {
  const [killStats, playerStats, uniqueStats, buildEvents, latestBuildAt] = await Promise.all([
    db
      .prepare(
        `
        SELECT
          COUNT(*) AS kills,
          SUM(CASE WHEN victim_name IS NOT NULL THEN 1 ELSE 0 END) AS kill_deaths,
          MAX(COALESCE(distance, 0)) AS longest_kill,
          MAX(COALESCE(occurred_at, created_at)) AS latest_at
        FROM kill_events
        WHERE linked_server_id IN (${PUBLIC_SERVER_SCOPE})
          AND ${MOCK_KILL_FILTER}
      `,
      )
      .first<{ kills: number | null; kill_deaths: number | null; longest_kill: number | null; latest_at: string | null }>(),
    db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN event_type = 'player_connected' THEN 1 ELSE 0 END) AS joins,
          SUM(CASE WHEN event_type = 'player_disconnected' THEN 1 ELSE 0 END) AS disconnects,
          SUM(CASE WHEN event_type IN (${DEATH_EVENT_TYPES.map(() => "?").join(", ")}) THEN 1 ELSE 0 END) AS other_deaths,
          COUNT(*) AS total,
          MAX(COALESCE(occurred_at, created_at)) AS latest_at
        FROM player_events
        WHERE linked_server_id IN (${PUBLIC_SERVER_SCOPE})
          AND ${MOCK_PLAYER_FILTER}
      `,
      )
      .bind(...DEATH_EVENT_TYPES)
      .first<{ joins: number | null; disconnects: number | null; other_deaths: number | null; total: number | null; latest_at: string | null }>(),
    db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM player_profiles
        WHERE linked_server_id IN (${PUBLIC_SERVER_SCOPE})
      `,
      )
      .first<{ total: number | null }>(),
    countPublicBuildEvents(db),
    latestPublicBuildEventAt(db),
  ]);

  const killsTracked = toNumber(killStats?.kills);
  const playerEventsTracked = toNumber(playerStats?.total);
  const latestEventAt = [killStats?.latest_at, playerStats?.latest_at, latestBuildAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    killsTracked,
    deathsTracked: toNumber(killStats?.kill_deaths) + toNumber(playerStats?.other_deaths),
    joinsTracked: toNumber(playerStats?.joins),
    disconnectsTracked: toNumber(playerStats?.disconnects),
    uniquePlayersTracked: toNumber(uniqueStats?.total),
    longestKill: toNumber(killStats?.longest_kill),
    totalEventsTracked: killsTracked + playerEventsTracked + buildEvents,
    latestEventAt,
  };
}

export function applyPublicAdmStatsSummaryToHomeStats<T extends HomeStatsLike>(
  payload: T,
  summary: PublicAdmStatsSummary,
): T {
  const data = {
    ...(payload.data ?? {}),
    killsTracked: summary.killsTracked,
    deathsTracked: summary.deathsTracked,
    joinsTracked: summary.joinsTracked,
    totalEventsTracked: summary.totalEventsTracked,
    longestKill: summary.longestKill,
  };
  const totals = {
    ...(payload.totals ?? {}),
    killsTracked: summary.killsTracked,
    deathsTracked: summary.deathsTracked,
    joinsTracked: summary.joinsTracked,
    totalEventsTracked: summary.totalEventsTracked,
    longestKill: summary.longestKill,
    latestEventAt: summary.latestEventAt,
  };
  const networkPulse = {
    ...(payload.network_pulse ?? {}),
    kills: summary.killsTracked,
    events: summary.totalEventsTracked,
  };

  return {
    ...payload,
    ...data,
    data,
    totals,
    network_pulse: networkPulse,
    admStatsFreshness: {
      latestEventAt: summary.latestEventAt,
      source: "canonical-adm-events",
    },
  };
}

export async function patchHomeStatsAdmStatsFromCanonicalEvents(env: Env): Promise<void> {
  if (!env.DB) {
    return;
  }

  const db = requireDb(env);
  const summary = await getPublicAdmStatsSummary(db);
  const generatedAt = new Date().toISOString();

  await Promise.all(
    PUBLIC_HOME_STATS_ADM_SNAPSHOT_KEYS.map(async (snapshot) => {
      const cached = await readPublicApiCache<HomeStatsLike>(env, snapshot.key).catch(() => null);
      if (!cached?.payload || typeof cached.payload !== "object") return;
      await writePublicApiCache(env, snapshot.key, applyPublicAdmStatsSummaryToHomeStats(cached.payload, summary), generatedAt, snapshot.accessLevel);
    }),
  );
}
