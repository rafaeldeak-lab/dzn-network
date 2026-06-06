import { requireDb } from "./db";
import {
  readPublicApiCache,
  writePublicApiCache,
} from "./public-api-cache";
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
