import { ensureAdmSyncSchema } from "../../_lib/adm-sync";
import { ensureLinkedServerMetadataColumns, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { uniquePublicSlug } from "../../_lib/onboarding";
import type { Env, PagesFunction } from "../../_lib/types";

type PublicServerRow = {
  id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string;
  tags_json: string | null;
  status: string;
  nitrado_service_name: string | null;
  player_slots: number | null;
  created_at: string | null;
  updated_at: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  adm_path: string | null;
  adm_logs_found: number | null;
  adm_last_checked_at: string | null;
  adm_sync_latest_file: string | null;
  adm_sync_latest_path: string | null;
  adm_sync_status: string | null;
  adm_sync_message: string | null;
  adm_sync_at: string | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  server_stats_updated_at: string | null;
  latest_success_sync_status: string | null;
  latest_success_sync_trigger: string | null;
  latest_success_sync_at: string | null;
};

type PublicRecentEvent = {
  source: "kill" | "player";
  event_type: string;
  label: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

type SafePublicServer = {
  public_slug: string;
  server_name: string;
  server_type: string;
  tags_json: string;
  status: string;
  nitrado_service_name: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  adm_status: "Connected" | "Discovered" | "Needs Review";
  latest_adm_file: string | null;
  stats_sync: "Active" | "Pending" | "Not Started";
  read_status: "Readable" | "Read Pending" | "Not Ready";
  player_slots: number | null;
  created_at: string | null;
  latest_sync_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  recent_events: PublicRecentEvent[];
  public_sync_source: "sync_runs" | "adm_sync_state" | "server_stats" | "linked_server_fallback";
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const url = new URL(request.url);
  const slug = sanitizeSlug(url.searchParams.get("slug"));

  if (!env.DB) {
    const mockServers = shouldShowMockServers(env) ? mockPublicServers() : [];
    return slug
      ? json({ server: mockServers.find((server) => server.public_slug === slug) ?? null })
      : json({ servers: mockServers, stats: buildPublicStats(mockServers) });
  }

  await ensureLinkedServerMetadataColumns(env);
  await ensureServerLogConfigTable(env);
  await ensureAdmSyncSchema(env);
  await ensurePublicSlugsForLiveServers(env);

  const rows = await queryPublicServers(env, slug);
  const servers = (await Promise.all(rows.map((row) => toSafePublicServer(env, row)))).filter((server): server is SafePublicServer => Boolean(server));

  if (slug) {
    return json({ server: servers[0] ?? null });
  }

  if (servers.length === 0 && shouldShowMockServers(env)) {
    const mockServers = mockPublicServers();
    return json({ servers: mockServers, stats: buildPublicStats(mockServers), mock: true });
  }

  return json({ servers, stats: buildPublicStats(servers) });
};

async function queryPublicServers(env: Env, slug: string | null) {
  const db = requireDb(env);
  const baseQuery = `
    SELECT
      linked_servers.id,
      linked_servers.public_slug,
      linked_servers.server_name,
      linked_servers.server_type,
      linked_servers.tags_json,
      linked_servers.status,
      linked_servers.nitrado_service_name,
      linked_servers.player_slots,
      linked_servers.created_at,
      linked_servers.updated_at,
      discord_guilds.name AS guild_name,
      discord_guilds.icon_url AS guild_icon_url,
      server_log_config.adm_path AS adm_path,
      onboarding_checks.adm_logs_found AS adm_logs_found,
      onboarding_checks.last_tested_at AS adm_last_checked_at,
      adm_sync_state.latest_adm_file AS adm_sync_latest_file,
      adm_sync_state.latest_adm_path AS adm_sync_latest_path,
      adm_sync_state.last_sync_status AS adm_sync_status,
      adm_sync_state.last_sync_message AS adm_sync_message,
      adm_sync_state.last_sync_at AS adm_sync_at,
      server_stats.total_kills,
      server_stats.total_deaths,
      server_stats.total_joins,
      server_stats.total_disconnects,
      server_stats.unique_players,
      server_stats.updated_at AS server_stats_updated_at,
      (
        SELECT status
        FROM sync_runs
        WHERE sync_runs.linked_server_id = linked_servers.id
          AND lower(sync_runs.status) IN ('completed', 'idle')
        ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
        LIMIT 1
      ) AS latest_success_sync_status,
      (
        SELECT trigger_type
        FROM sync_runs
        WHERE sync_runs.linked_server_id = linked_servers.id
          AND lower(sync_runs.status) IN ('completed', 'idle')
        ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
        LIMIT 1
      ) AS latest_success_sync_trigger,
      (
        SELECT COALESCE(finished_at, started_at, created_at)
        FROM sync_runs
        WHERE sync_runs.linked_server_id = linked_servers.id
          AND lower(sync_runs.status) IN ('completed', 'idle')
        ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
        LIMIT 1
      ) AS latest_success_sync_at
    FROM linked_servers
    LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
    LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
    LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
    LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
    LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
    WHERE lower(linked_servers.status) = 'live'
  `;

  if (slug) {
    const result = await db
      .prepare(`${baseQuery} AND linked_servers.public_slug = ? LIMIT 1`)
      .bind(slug)
      .all<PublicServerRow>();
    return result.results ?? [];
  }

  const result = await db
    .prepare(
      `${baseQuery}
       ORDER BY
         CASE
           WHEN onboarding_checks.adm_logs_found = 1 THEN 0
           WHEN server_log_config.adm_path IS NOT NULL THEN 2
           ELSE 4
         END ASC,
         linked_servers.updated_at DESC,
         linked_servers.created_at DESC
       LIMIT 100`,
    )
    .all<PublicServerRow>();
  return result.results ?? [];
}

async function ensurePublicSlugsForLiveServers(env: Env) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.server_name,
        linked_servers.nitrado_service_name,
        linked_servers.public_slug,
        discord_guilds.name AS guild_name
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.public_slug IS NULL OR linked_servers.public_slug = '')`,
    )
    .all<{ id: string; server_name: string | null; nitrado_service_name: string | null; public_slug: string | null; guild_name: string | null }>();

  for (const server of result.results ?? []) {
    const sourceName = firstString(server.guild_name, server.server_name, server.nitrado_service_name) ?? "dayz-server";
    const slug = await uniquePublicSlug(env, sourceName, server.id);
    await db
      .prepare("UPDATE linked_servers SET public_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(slug, server.id)
      .run();
  }
}

async function ensureServerLogConfigTable(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_log_config (
        id TEXT PRIMARY KEY,
        linked_server_id TEXT UNIQUE NOT NULL,
        adm_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_server_log_config_linked_server_id ON server_log_config(linked_server_id)")
    .run();
}

async function toSafePublicServer(env: Env, row: PublicServerRow) {
  if (!row.public_slug) return null;
  const latestAdmPath = row.adm_sync_latest_path ?? row.adm_path;
  const latestAdmFile = row.adm_sync_latest_file ?? fileNameFromPath(latestAdmPath);
  const hasActivity =
    numberOrZero(row.total_joins) > 0 ||
    numberOrZero(row.total_disconnects) > 0 ||
    numberOrZero(row.total_deaths) > 0 ||
    numberOrZero(row.total_kills) > 0 ||
    numberOrZero(row.unique_players) > 0;
  const latestSyncCompleted = stringEquals(row.latest_success_sync_status, "completed") || stringEquals(row.latest_success_sync_status, "idle");
  const admSyncCompleted = stringEquals(row.adm_sync_status, "completed") || stringEquals(row.adm_sync_status, "idle");
  const readable = latestSyncCompleted || admSyncCompleted || hasActivity || Number(row.adm_logs_found) === 1;
  const admStatus = readable ? "Connected" : latestAdmFile || row.adm_path ? "Discovered" : "Needs Review";
  const statsSync = latestSyncCompleted || admSyncCompleted || hasActivity || (readable && latestSyncCompleted)
    ? "Active"
    : latestAdmFile || row.adm_path
      ? "Pending"
      : "Not Started";
  const publicSyncSource = latestSyncCompleted
    ? "sync_runs"
    : admSyncCompleted
      ? "adm_sync_state"
      : hasActivity
        ? "server_stats"
        : "linked_server_fallback";

  return {
    public_slug: row.public_slug,
    server_name: row.server_name,
    server_type: row.server_type,
    tags_json: normalizePublicTagsJson(row.tags_json),
    status: row.status,
    nitrado_service_name: row.nitrado_service_name,
    guild_name: row.guild_name,
    guild_icon_url: row.guild_icon_url,
    adm_status: admStatus,
    latest_adm_file: latestAdmFile,
    stats_sync: statsSync,
    read_status: readable ? "Readable" : latestAdmFile ? "Read Pending" : "Not Ready",
    player_slots: row.player_slots,
    created_at: row.created_at,
    latest_sync_at: row.latest_success_sync_at ?? row.adm_sync_at ?? row.server_stats_updated_at,
    total_kills: numberOrZero(row.total_kills),
    total_deaths: numberOrZero(row.total_deaths),
    total_joins: numberOrZero(row.total_joins),
    total_disconnects: numberOrZero(row.total_disconnects),
    unique_players: numberOrZero(row.unique_players),
    recent_events: await getPublicRecentEvents(env, row.id),
    public_sync_source: publicSyncSource,
  } satisfies SafePublicServer;
}

function buildPublicStats(servers: SafePublicServer[]) {
  return {
    totalServers: servers.length,
    pvpServers: servers.filter((server) => server.server_type === "PVP").length,
    pveServers: servers.filter((server) => server.server_type === "PVE").length,
    deathmatchServers: servers.filter((server) => server.server_type === "DEATHMATCH").length,
    statsSyncActive: servers.filter((server) => server.stats_sync === "Active").length,
    statsSyncPending: servers.filter((server) => server.stats_sync !== "Active").length,
  };
}

function mockPublicServers(): SafePublicServer[] {
  return [
    {
      public_slug: "pandora-dayz",
      server_name: "Pandora DayZ",
      server_type: "PVP / PVE",
      tags_json: JSON.stringify(["Factions", "Trader / Economy", "Events", "Active Admins"]),
      status: "live",
      nitrado_service_name: "Pandora DayZ",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      adm_status: "Discovered",
      latest_adm_file: "DayZServer_PS4_x64_2026-05-14_13-01-57.ADM",
      stats_sync: "Pending",
      read_status: "Read Pending",
      player_slots: 60,
      created_at: new Date().toISOString(),
      latest_sync_at: null,
      total_kills: 0,
      total_deaths: 0,
      total_joins: 0,
      total_disconnects: 0,
      unique_players: 0,
      recent_events: [],
      public_sync_source: "linked_server_fallback",
    },
    {
      public_slug: "warlords-pvp",
      server_name: "Warlords PvP",
      server_type: "PVP",
      tags_json: JSON.stringify(["Raid Focused", "Factions", "Weekend Raids", "KOS"]),
      status: "live",
      nitrado_service_name: "Warlords PvP",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      adm_status: "Connected",
      latest_adm_file: "DayZServer_PS4_x64_2026-05-14_12-29-09.ADM",
      stats_sync: "Active",
      read_status: "Readable",
      player_slots: 70,
      created_at: new Date().toISOString(),
      latest_sync_at: new Date().toISOString(),
      total_kills: 12,
      total_deaths: 18,
      total_joins: 42,
      total_disconnects: 36,
      unique_players: 14,
      recent_events: [],
      public_sync_source: "sync_runs",
    },
    {
      public_slug: "apocalypse-dm",
      server_name: "Apocalypse DM",
      server_type: "DEATHMATCH",
      tags_json: JSON.stringify(["Hardcore", "Events", "Modded"]),
      status: "live",
      nitrado_service_name: "Apocalypse DM",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      adm_status: "Needs Review",
      latest_adm_file: null,
      stats_sync: "Not Started",
      read_status: "Not Ready",
      player_slots: 50,
      created_at: new Date().toISOString(),
      latest_sync_at: null,
      total_kills: 0,
      total_deaths: 0,
      total_joins: 0,
      total_disconnects: 0,
      unique_players: 0,
      recent_events: [],
      public_sync_source: "linked_server_fallback",
    },
  ];
}

async function getPublicRecentEvents(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at
       FROM (
         SELECT
           'kill' AS source,
           'player_killed' AS event_type,
           NULL AS player_name,
           killer_name,
           victim_name,
           weapon,
           distance,
           occurred_at,
           created_at,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM kill_events
         WHERE linked_server_id = ?
         UNION ALL
         SELECT
           'player' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM player_events
         WHERE linked_server_id = ?
       )
       ORDER BY sort_time DESC, created_at DESC
       LIMIT 6`,
    )
    .bind(linkedServerId, linkedServerId)
    .all<Omit<PublicRecentEvent, "label">>();

  return (result.results ?? []).map((event) => ({
    ...event,
    label: publicEventLabel(event.event_type, event.source),
  })) satisfies PublicRecentEvent[];
}

function normalizePublicTagsJson(value: string | null) {
  if (!value) return "[]";
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return "[]";
    return JSON.stringify(parsed.filter((item): item is string => typeof item === "string").slice(0, 5));
  } catch {
    return "[]";
  }
}

function shouldShowMockServers(env: Env) {
  return isMockAuth(env.MOCK_AUTH) || isMockNitrado(env.MOCK_NITRADO);
}

function publicEventLabel(eventType: string, source: "kill" | "player") {
  if (source === "kill" || eventType === "player_killed") return "PvP Kill";
  const labels: Record<string, string> = {
    player_connected: "Connected",
    player_connecting: "Connecting",
    player_disconnected: "Disconnected",
    player_died_stats: "Died",
    player_killed_environment: "Died",
    player_suicide: "Suicide",
    player_hit: "Hit",
    player_hit_explosion: "Hit",
    player_hit_unknown_attacker: "Hit",
    player_placed_object: "Placed Object",
    playerlist_entry: "Player Snapshot",
    plain_player_state: "Player Snapshot",
  };
  return labels[eventType] ?? eventType.replace(/^player_/, "").replace(/_/g, " ");
}

function fileNameFromPath(path: string | null) {
  return path ? path.split("/").filter(Boolean).at(-1) ?? null : null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function stringEquals(value: string | null, expected: string) {
  return typeof value === "string" && value.toLowerCase() === expected;
}

function sanitizeSlug(value: string | null) {
  if (!value) return null;
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return slug || null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
