import { requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import type { Env, PagesFunction } from "../../_lib/types";

type TotalsRow = {
  serversLinked: number | null;
  statsActiveServers: number | null;
  playersSeenFromStats: number | null;
  killsTracked: number | null;
  deathsTracked: number | null;
  joinsTracked: number | null;
};

type GameModeRow = {
  server_type: string | null;
  count: number | null;
};

type TopServerRow = {
  public_slug: string | null;
  server_name: string;
  guild_name: string | null;
  server_type: string | null;
  total_kills: number | null;
  unique_players: number | null;
  stats_active: number | null;
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
  source: "kill" | "player" | "sync" | "server";
  event_type: string;
  server_name: string | null;
  public_slug: string | null;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

const MOCK_PLAYER_PREFIXES = ["MockSurvivor", "MockBandit", "MockRunner"];

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  if (!env.DB) {
    return json(emptyHomeStats());
  }

  const data = await buildHomeStats(env);
  return json(data);
};

async function buildHomeStats(env: Env) {
  const db = requireDb(env);
  const [totals, profileCount, recentEventsCount, gameModes, topServers, topPlayers, recentActivity] = await Promise.all([
    getTotals(db),
    getPlayerProfileCount(db),
    getRecentEventsCount(db),
    getGameModes(db),
    getTopServers(db),
    getTopPlayers(db),
    getRecentActivity(db),
  ]);

  const playersSeen = Math.max(numberOrZero(totals.playersSeenFromStats), profileCount);
  const syncActive = numberOrZero(totals.statsActiveServers);
  const serversLinked = numberOrZero(totals.serversLinked);

  return {
    ok: true,
    totals: {
      serversLinked,
      statsActiveServers: syncActive,
      playersSeen,
      killsTracked: numberOrZero(totals.killsTracked),
      deathsTracked: numberOrZero(totals.deathsTracked),
      joinsTracked: numberOrZero(totals.joinsTracked),
      recentEventsCount,
    },
    topServers,
    topPlayers,
    recentActivity,
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
        SUM(
          CASE
            WHEN COALESCE(server_stats.total_joins, 0) > 0
              OR COALESCE(server_stats.total_disconnects, 0) > 0
              OR COALESCE(server_stats.total_deaths, 0) > 0
              OR COALESCE(server_stats.total_kills, 0) > 0
              OR COALESCE(server_stats.unique_players, 0) > 0
              OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle')
              OR EXISTS (
                SELECT 1
                FROM sync_runs
                WHERE sync_runs.linked_server_id = linked_servers.id
                  AND lower(sync_runs.status) IN ('completed', 'idle')
                LIMIT 1
              )
            THEN 1 ELSE 0
          END
        ) AS statsActiveServers,
        SUM(COALESCE(server_stats.unique_players, 0)) AS playersSeenFromStats,
        SUM(COALESCE(server_stats.total_kills, 0)) AS killsTracked,
        SUM(COALESCE(server_stats.total_deaths, 0)) AS deathsTracked,
        SUM(COALESCE(server_stats.total_joins, 0)) AS joinsTracked
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'`,
    )
    .first<TotalsRow>();
  return row ?? {
    serversLinked: 0,
    statsActiveServers: 0,
    playersSeenFromStats: 0,
    killsTracked: 0,
    deathsTracked: 0,
    joinsTracked: 0,
  };
}

async function getPlayerProfileCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(player_profiles.id) AS count
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${mockNameFilterSql("player_profiles.player_name")}`,
    )
    .first<{ count: number | null }>();
  return numberOrZero(row?.count);
}

async function getRecentEventsCount(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM player_events
       INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND COALESCE(player_events.occurred_at, player_events.created_at) >= datetime('now', '-1 day')
         AND ${mockNameFilterSql("player_events.player_name")}`,
    )
    .first<{ count: number | null }>();
  return numberOrZero(row?.count);
}

async function getGameModes(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT server_type, COUNT(*) AS count
       FROM linked_servers
       WHERE lower(status) = 'live'
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
    if (type === "PVP / PVE") counts.pvpPve = numberOrZero(row.count);
  }

  return counts;
}

async function getTopServers(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.public_slug,
        linked_servers.server_name,
        linked_servers.server_type,
        discord_guilds.name AS guild_name,
        COALESCE(server_stats.total_kills, 0) AS total_kills,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
            OR lower(COALESCE(adm_sync_state.last_sync_status, '')) IN ('completed', 'idle')
          THEN 1 ELSE 0
        END AS stats_active
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
       ORDER BY stats_active DESC, COALESCE(server_stats.total_kills, 0) DESC, COALESCE(server_stats.unique_players, 0) DESC, linked_servers.created_at DESC
       LIMIT 6`,
    )
    .all<TopServerRow>();

  return (result.results ?? []).map((row) => ({
    public_slug: row.public_slug,
    server_name: row.server_name,
    guild_name: row.guild_name,
    server_type: row.server_type,
    total_kills: numberOrZero(row.total_kills),
    unique_players: numberOrZero(row.unique_players),
    stats_active: Number(row.stats_active) === 1,
  }));
}

async function getTopPlayers(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        player_profiles.player_name,
        linked_servers.server_name,
        linked_servers.public_slug,
        player_profiles.kills,
        player_profiles.deaths,
        player_profiles.longest_kill_distance
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
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
           linked_servers.server_name,
           linked_servers.public_slug,
           NULL AS player_name,
           kill_events.killer_name,
           kill_events.victim_name,
           kill_events.weapon,
           kill_events.distance,
           kill_events.occurred_at,
           kill_events.created_at,
           COALESCE(kill_events.occurred_at, kill_events.created_at) AS sort_time
         FROM kill_events
         INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${mockNameFilterSql("kill_events.killer_name")}
           AND ${mockNameFilterSql("kill_events.victim_name")}
         UNION ALL
         SELECT
           'player' AS source,
           player_events.event_type,
           linked_servers.server_name,
           linked_servers.public_slug,
           player_events.player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           player_events.occurred_at,
           player_events.created_at,
           COALESCE(player_events.occurred_at, player_events.created_at) AS sort_time
         FROM player_events
         INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND ${mockNameFilterSql("player_events.player_name")}
         UNION ALL
         SELECT
           'sync' AS source,
           'sync_completed' AS event_type,
           linked_servers.server_name,
           linked_servers.public_slug,
           NULL AS player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) AS occurred_at,
           sync_runs.created_at,
           COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) AS sort_time
         FROM sync_runs
         INNER JOIN linked_servers ON linked_servers.id = sync_runs.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND lower(sync_runs.status) IN ('completed', 'idle')
         UNION ALL
         SELECT
           'server' AS source,
           'server_joined' AS event_type,
           linked_servers.server_name,
           linked_servers.public_slug,
           NULL AS player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           linked_servers.created_at AS occurred_at,
           linked_servers.created_at,
           linked_servers.created_at AS sort_time
         FROM linked_servers
         WHERE lower(linked_servers.status) = 'live'
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
  }));
}

function activityTitle(row: RecentActivityRow) {
  if (row.source === "kill") {
    const weapon = row.weapon ? ` with ${row.weapon}` : "";
    return `${row.killer_name ?? "Survivor"} eliminated ${row.victim_name ?? "a survivor"}${weapon}`;
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

function emptyHomeStats() {
  return {
    ok: true,
    totals: {
      serversLinked: 0,
      statsActiveServers: 0,
      playersSeen: 0,
      killsTracked: 0,
      deathsTracked: 0,
      joinsTracked: 0,
      recentEventsCount: 0,
    },
    topServers: [],
    topPlayers: [],
    recentActivity: [],
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
