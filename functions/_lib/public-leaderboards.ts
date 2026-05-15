import { ensureAdmSyncSchema } from "./adm-sync";
import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import type { Env } from "./types";

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
  score: number;
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

type PublicLongestKillRow = {
  player_name: string | null;
  victim_name: string | null;
  server_name: string | null;
  server_slug: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
};

type PublicServerLookupRow = {
  id: string;
  public_slug: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  guild_name: string | null;
};

export async function getPublicLeaderboardsPayload(env: Env) {
  if (!env.DB) return emptyPublicLeaderboards();

  await ensurePublicLeaderboardSchema(env);

  const [topServers, topPlayers, longestKills] = await Promise.all([
    getTopServers(env, 25),
    getTopPlayers(env, 50),
    getLongestKills(env, 50),
  ]);

  return {
    ok: true,
    top_servers: topServers,
    top_players: topPlayers,
    longest_kills: longestKills,
    updated_at: new Date().toISOString(),
  };
}

export async function getPublicServerLeaderboardPayload(env: Env, options: { serverId?: string | null; slug?: string | null; limit?: number }) {
  if (!env.DB) {
    return { ok: true, players: [], updated_at: new Date().toISOString() };
  }

  await ensurePublicLeaderboardSchema(env);

  const linkedServerId = options.serverId ?? (options.slug ? await resolvePublicLinkedServerId(env, options.slug) : null);
  if (!linkedServerId) {
    return { ok: true, players: [], updated_at: new Date().toISOString() };
  }

  const players = await getTopPlayers(env, options.limit ?? 10, linkedServerId);
  return {
    ok: true,
    players,
    updated_at: new Date().toISOString(),
  };
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

async function getTopServers(env: Env, limit: number) {
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
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
       ORDER BY kills DESC, longest_kill DESC, unique_players DESC, linked_servers.created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<PublicServerStatRow>();

  return (result.results ?? []).map((row, index) => {
    const kills = numberOrZero(row.kills);
    const deaths = numberOrZero(row.deaths);
    const longestKill = numberOrZero(row.longest_kill);
    const kd = calculateKd(kills, deaths);
    return {
      rank: index + 1,
      server_id: row.server_id,
      server_name: row.server_name ?? "Unnamed DZN Server",
      slug: row.slug,
      mode: normalizeMode(row.mode),
      kills,
      deaths,
      kd: kd.value,
      kd_label: kd.label,
      longest_kill: longestKill,
      score: calculateServerScore({
        kills,
        longestKill,
        uniquePlayers: numberOrZero(row.unique_players),
        totalJoins: numberOrZero(row.total_joins),
        totalDisconnects: numberOrZero(row.total_disconnects),
      }),
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

async function getLongestKills(env: Env, limit: number) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT
        kill_events.killer_name AS player_name,
        kill_events.victim_name,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug AS server_slug,
        kill_events.weapon,
        kill_events.distance,
        COALESCE(kill_events.occurred_at, kill_events.created_at) AS occurred_at
       FROM kill_events
       INNER JOIN linked_servers ON linked_servers.id = kill_events.linked_server_id
       WHERE lower(linked_servers.status) = 'live'
         AND kill_events.killer_name IS NOT NULL
         AND kill_events.victim_name IS NOT NULL
         AND COALESCE(kill_events.distance, 0) > 0
         AND ${mockNameFilterSql("kill_events.killer_name")}
         AND ${mockNameFilterSql("kill_events.victim_name")}
       ORDER BY kill_events.distance DESC, occurred_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<PublicLongestKillRow>();

  return rankLongestKills(result.results ?? []);
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
  return rows
    .filter((row) => numberOrZero(row.distance) > 0)
    .sort((a, b) => {
      const distanceDiff = numberOrZero(b.distance) - numberOrZero(a.distance);
      if (distanceDiff) return distanceDiff;
      return dateValue(b.occurred_at) - dateValue(a.occurred_at);
    })
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

export function calculateKd(kills: number, deaths: number) {
  const safeKills = numberOrZero(kills);
  const safeDeaths = numberOrZero(deaths);
  if (safeKills === 0 && safeDeaths === 0) return { value: null, label: "Awaiting data" };
  if (safeKills > 0 && safeDeaths === 0) return { value: safeKills, label: "Flawless" };
  const value = safeDeaths > 0 ? roundTwo(safeKills / safeDeaths) : 0;
  return { value, label: value.toFixed(2) };
}

export function calculateServerScore(input: {
  kills: number;
  longestKill: number;
  uniquePlayers: number;
  totalJoins?: number;
  totalDisconnects?: number;
}) {
  const activityScore = Math.min(numberOrZero(input.totalJoins) + numberOrZero(input.totalDisconnects), 500);
  return Math.round(numberOrZero(input.kills) * 10 + numberOrZero(input.longestKill) + numberOrZero(input.uniquePlayers) * 5 + activityScore);
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
       LIMIT 500`,
    )
    .all<PublicServerLookupRow>();

  const normalized = sanitizeSlug(slug);
  if (!normalized) return null;

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

function emptyPublicLeaderboards() {
  return {
    ok: true,
    top_servers: [],
    top_players: [],
    longest_kills: [],
    updated_at: new Date().toISOString(),
  };
}
