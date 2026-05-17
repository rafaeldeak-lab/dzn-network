import { ensureAdmSyncSchema } from "./adm-sync";
import { getRankedBuildServers, type PublicBuildLeaderboardRow } from "./build-events";
import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import { calculateServerScore, calculateServerScoreBreakdown, rankServers, type ServerScoreBreakdown } from "./server-ranking";
import type { Env } from "./types";

export { calculateServerScore, calculateServerScoreBreakdown };

const MOCK_PLAYER_PREFIXES = ["MockSurvivor", "MockBandit", "MockRunner"];

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

export async function getPublicLeaderboardsPayload(env: Env, viewerLoggedIn = true) {
  if (!env.DB) return applyLeaderboardsAccess(emptyPublicLeaderboards(), viewerLoggedIn);

  await ensurePublicLeaderboardSchema(env);

  const [topServers, topPlayers, killSummary, buildLeaderboard] = await Promise.all([
    getRankedPublicServers(env, 25),
    getTopPlayers(env, 50),
    getLongestKillSummary(env, 20),
    getRankedBuildServers(env, 25),
  ]);

  return applyLeaderboardsAccess({
    ok: true,
    top_servers: topServers,
    top_players: topPlayers,
    best_overall_kill: killSummary.bestOverallKill,
    latest_kill: killSummary.latestKill,
    personal_best_kills: killSummary.personalBestKills,
    longest_kills: killSummary.personalBestKills,
    build_leaderboard: buildLeaderboard,
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
  await ensureLinkedServerMetadataColumns(env);
  await ensureAdmSyncSchema(env);
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
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL) AS deaths,
        COALESCE(server_stats.unique_players, (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id), 0) AS unique_players,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
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

async function getTopPlayers(env: Env, limit: number, linkedServerId?: string) {
  const db = requireDb(env);
  const serverFilter = linkedServerId ? "AND kill_events.linked_server_id = ?" : "";

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
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND kill_events.killer_name IS NOT NULL
         AND ${mockNameFilterSql("kill_events.killer_name")}
         ${serverFilter}
       GROUP BY kill_events.linked_server_id, player_key, linked_servers.public_slug
       ORDER BY kills DESC, longest_kill DESC, last_seen DESC`,
  );
  const killRows = linkedServerId
    ? await killStatement.bind(linkedServerId).all<PublicPlayerKillRow>()
    : await killStatement.all<PublicPlayerKillRow>();

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
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND kill_events.victim_name IS NOT NULL
         AND ${mockNameFilterSql("kill_events.victim_name")}
         ${serverFilter}
       GROUP BY kill_events.linked_server_id, player_key, linked_servers.public_slug
       ORDER BY deaths DESC, last_seen DESC`,
  );
  const deathRows = linkedServerId
    ? await deathStatement.bind(linkedServerId).all<PublicPlayerDeathRow>()
    : await deathStatement.all<PublicPlayerDeathRow>();

  return rankPublicPlayers(mergePlayerRows(killRows.results ?? [], deathRows.results ?? []), limit);
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

function emptyPublicLeaderboards() {
  return {
    ok: true,
    top_servers: [],
    top_players: [],
    best_overall_kill: null,
    latest_kill: null,
    personal_best_kills: [],
    longest_kills: [],
    build_leaderboard: [],
    updated_at: new Date().toISOString(),
  };
}
