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
  adm_status: "Connected" | "Discovered" | "Pending";
  latest_adm_file: string | null;
  stats_sync: "Active" | "Pending";
  player_slots: number | null;
  created_at: string | null;
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
  await ensurePublicSlugsForLiveServers(env);

  const rows = await queryPublicServers(env, slug);
  const servers = rows.map(toSafePublicServer).filter((server): server is SafePublicServer => Boolean(server));

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
      onboarding_checks.last_tested_at AS adm_last_checked_at
    FROM linked_servers
    LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
    LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
    LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
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
    .prepare(`${baseQuery} ORDER BY linked_servers.updated_at DESC, linked_servers.created_at DESC LIMIT 100`)
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

function toSafePublicServer(row: PublicServerRow) {
  if (!row.public_slug) return null;
  const latestAdmFile = row.adm_path ? row.adm_path.split("/").filter(Boolean).at(-1) ?? null : null;
  const admStatus = Number(row.adm_logs_found) === 1 ? "Connected" : row.adm_path ? "Discovered" : "Pending";

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
    stats_sync: Number(row.adm_logs_found) === 1 ? "Active" : "Pending",
    player_slots: row.player_slots,
    created_at: row.created_at,
  } satisfies SafePublicServer;
}

function buildPublicStats(servers: SafePublicServer[]) {
  return {
    totalServers: servers.length,
    pvpServers: servers.filter((server) => server.server_type === "PVP").length,
    pveServers: servers.filter((server) => server.server_type === "PVE").length,
    deathmatchServers: servers.filter((server) => server.server_type === "DEATHMATCH").length,
    statsSyncActive: servers.filter((server) => server.stats_sync === "Active").length,
    statsSyncPending: servers.filter((server) => server.stats_sync === "Pending").length,
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
      player_slots: 60,
      created_at: new Date().toISOString(),
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
      player_slots: 70,
      created_at: new Date().toISOString(),
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
      adm_status: "Pending",
      latest_adm_file: null,
      stats_sync: "Pending",
      player_slots: 50,
      created_at: new Date().toISOString(),
    },
  ];
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
