import { ensureAdmSyncSchema } from "../../_lib/adm-sync";
import { ensureLinkedServerMetadataColumns, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { getRankedPublicServers } from "../../_lib/public-leaderboards";
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

type MapNodeRow = {
  public_slug: string | null;
  server_name: string | null;
  guild_name: string | null;
  server_type: string | null;
  region: string | null;
  platform: string | null;
  map_name: string | null;
  stats_active: number | null;
};

const MOCK_PLAYER_PREFIXES = ["MockSurvivor", "MockBandit", "MockRunner"];

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  if (!env.DB) {
    return json(emptyHomeStats());
  }

  await ensureLinkedServerMetadataColumns(env);
  await ensureAdmSyncSchema(env);
  const data = await buildHomeStats(env);
  return json(data);
};

async function buildHomeStats(env: Env) {
  const db = requireDb(env);
  const [totals, profileCount, recentEventsCount, gameModes, topServers, topPlayers, recentActivity, mapNodes] = await Promise.all([
    getTotals(db),
    getPlayerProfileCount(db),
    getRecentEventsCount(db),
    getGameModes(db),
    getTopServers(env),
    getTopPlayers(db),
    getRecentActivity(db),
    getMapNodes(db),
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
        (
          SELECT COUNT(*)
          FROM kill_events
          INNER JOIN linked_servers AS live_kill_servers ON live_kill_servers.id = kill_events.linked_server_id
          WHERE lower(live_kill_servers.status) = 'live'
            AND (live_kill_servers.merged_into_server_id IS NULL OR live_kill_servers.merged_into_server_id = '')
        ) AS killsTracked,
        (
          SELECT COUNT(*)
          FROM kill_events
          INNER JOIN linked_servers AS live_death_servers ON live_death_servers.id = kill_events.linked_server_id
          WHERE lower(live_death_servers.status) = 'live'
            AND (live_death_servers.merged_into_server_id IS NULL OR live_death_servers.merged_into_server_id = '')
            AND kill_events.victim_name IS NOT NULL
        ) AS deathsTracked,
        SUM(COALESCE(server_stats.total_joins, 0)) AS joinsTracked
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
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
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
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
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
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
       FROM (
         SELECT COALESCE(NULLIF(server_mode, ''), server_type) AS server_type
         FROM linked_servers
         WHERE lower(status) = 'live'
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
           kill_events.occurred_at,
           kill_events.created_at,
           COALESCE(kill_events.occurred_at, kill_events.created_at) AS sort_time
         FROM kill_events
         INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
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
           player_events.occurred_at,
           player_events.created_at,
           COALESCE(player_events.occurred_at, player_events.created_at) AS sort_time
         FROM player_events
         INNER JOIN linked_servers ON linked_servers.id = player_events.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND ${mockNameFilterSql("player_events.player_name")}
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
           COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) AS occurred_at,
           sync_runs.created_at,
           COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) AS sort_time
         FROM sync_runs
         INNER JOIN linked_servers ON linked_servers.id = sync_runs.linked_server_id
         WHERE lower(linked_servers.status) = 'live'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND lower(sync_runs.status) IN ('completed', 'idle')
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
           linked_servers.created_at AS occurred_at,
           linked_servers.created_at,
           linked_servers.created_at AS sort_time
         FROM linked_servers
         WHERE lower(linked_servers.status) = 'live'
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
  }));
}

async function getMapNodes(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        discord_guilds.name AS guild_name,
        COALESCE(NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.region,
        linked_servers.platform,
        linked_servers.map_name,
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
        END AS stats_active
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY linked_servers.updated_at DESC, linked_servers.created_at DESC
       LIMIT 80`,
    )
    .all<MapNodeRow>();

  const coordinateCounts = new Map<string, number>();
  return (result.results ?? []).flatMap((row, index) => {
    const serverName = firstString(row.server_name, row.guild_name) ?? "Unnamed DZN Server";
    const placement = mapPlacementFor(row);
    if (!placement.usable) return [];
    const key = `${Math.round(placement.x)}:${Math.round(placement.y)}`;
    const count = coordinateCounts.get(key) ?? 0;
    coordinateCounts.set(key, count + 1);
    const offset = nodeOffset(count);
    const x = clamp(placement.x + offset.x, 6, 94);
    const y = clamp(placement.y + offset.y, 9, 88);
    const regionLabel = placement.regionLabel;

    return {
      id: row.public_slug ?? `server-${index + 1}`,
      name: serverName,
      display_name: serverName,
      slug: row.public_slug,
      mode: normalizeText(row.server_type, "UNKNOWN"),
      server_type: normalizeText(row.server_type, "UNKNOWN"),
      status: Number(row.stats_active) === 1 ? "active" : "pending",
      sync_status: Number(row.stats_active) === 1 ? "active" : "pending",
      region: regionLabel,
      country: null,
      city: null,
      latitude: null,
      longitude: null,
      lat: null,
      lng: null,
      x: roundOne(x),
      y: roundOne(y),
      active: Number(row.stats_active) === 1,
      approximate: placement.approximate,
    };
  });
}

function mapPlacementFor(row: MapNodeRow) {
  const rawRegion = firstString(row.region);
  const publicRegion = safePublicRegion(rawRegion);
  const searchable = [publicRegion, row.server_name, row.guild_name, row.platform, row.map_name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  const location = approximateRegion(searchable);
  if (location) {
    return {
      x: location.x,
      y: location.y,
      regionLabel: publicRegion ?? location.label,
      approximate: true,
      usable: true,
    };
  }

  return {
    x: 50,
    y: 50,
    regionLabel: publicRegion ?? "Location awaiting metadata",
    approximate: true,
    usable: false,
  };
}

function approximateRegion(value: string) {
  const checks: Array<{ terms: string[]; x: number; y: number; label: string }> = [
    { terms: ["united kingdom", "great britain", " britain", " gb ", " uk ", "london", "england", "scotland", "wales"], x: 48, y: 34, label: "United Kingdom" },
    { terms: ["germany", "deutschland", "berlin", "frankfurt", "eu-central"], x: 52, y: 36, label: "Europe" },
    { terms: ["europe", " eu ", "eu-west", "france", "spain", "italy", "netherlands", "poland"], x: 51, y: 37, label: "Europe" },
    { terms: ["north america", " usa", " us ", "united states", "america", "canada", "mexico", "us-east", "us-west"], x: 24, y: 40, label: "North America" },
    { terms: ["south america", "brazil", "argentina", "chile"], x: 34, y: 66, label: "South America" },
    { terms: ["asia", "singapore", "japan", "korea", "china", "india"], x: 70, y: 42, label: "Asia" },
    { terms: ["oceania", "australia", "sydney", "new zealand"], x: 78, y: 72, label: "Oceania" },
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

function nodeOffset(index: number) {
  const offsets = [
    { x: 0, y: 0 },
    { x: 2.2, y: -1.8 },
    { x: -2.1, y: 1.7 },
    { x: 2.5, y: 2.4 },
    { x: -2.4, y: -2.2 },
    { x: 4.1, y: 0.3 },
    { x: -4, y: -0.2 },
  ];
  return offsets[index % offsets.length];
}

function activityTitle(row: RecentActivityRow) {
  if (row.source === "kill") {
    const weapon = row.weapon ? ` with ${row.weapon}` : "";
    return `${row.killer_name ?? "Player"} eliminated ${row.victim_name ?? "a player"}${weapon}`;
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

function roundOne(value: number) {
  return Math.round(numberOrZero(value) * 10) / 10;
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
      playersSeen: 0,
      killsTracked: 0,
      deathsTracked: 0,
      joinsTracked: 0,
      recentEventsCount: 0,
    },
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
