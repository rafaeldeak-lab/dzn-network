import { requireDb } from "./db";
import type { Env } from "./types";

export type PlayerSavedServerSummary = {
  linked_server_id: string;
  public_slug: string;
  server_name: string;
  server_type: string;
  guild_name: string | null;
  guild_icon_url: string | null;
  platform: string | null;
  map_name: string | null;
  public_short_description: string | null;
  current_players: number | null;
  max_players: number | null;
  saved_at: string;
};

type PlayerSavedServerRow = PlayerSavedServerSummary;

const MAX_SAVED_SERVER_IDS = 100;
const MAX_SAVED_SERVER_ROWS = 50;

const publicSavableServerWhere = `
  lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  AND linked_servers.public_slug IS NOT NULL
  AND trim(linked_servers.public_slug) != ''
`;

export function sanitizePlayerSavedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

export function sanitizePlayerSavedServerIds(values: Iterable<unknown>) {
  const sanitized = new Set<string>();
  for (const value of values) {
    const id = sanitizePlayerSavedServerId(value);
    if (id) sanitized.add(id);
    if (sanitized.size >= MAX_SAVED_SERVER_IDS) break;
  }
  return [...sanitized];
}

export async function readPlayerSavedServersForUser(env: Env, userId: string, linkedServerIds: readonly string[] = []) {
  const db = requireDb(env);
  const filteredIds = sanitizePlayerSavedServerIds(linkedServerIds);
  const filters = [`player_saved_servers.user_id = ?`, publicSavableServerWhere];
  const bindings: unknown[] = [userId];

  if (filteredIds.length) {
    filters.push(`player_saved_servers.linked_server_id IN (${filteredIds.map(() => "?").join(", ")})`);
    bindings.push(...filteredIds);
  }

  const rows = await db
    .prepare(
      `SELECT
        player_saved_servers.linked_server_id,
        linked_servers.public_slug,
        linked_servers.server_name,
        linked_servers.server_type,
        discord_guilds.name AS guild_name,
        discord_guilds.icon_url AS guild_icon_url,
        linked_servers.platform,
        linked_servers.map_name,
        linked_servers.public_short_description,
        linked_servers.current_players,
        linked_servers.max_players,
        player_saved_servers.created_at AS saved_at
       FROM player_saved_servers
       INNER JOIN linked_servers ON linked_servers.id = player_saved_servers.linked_server_id
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE ${filters.join("\n         AND ")}
       ORDER BY player_saved_servers.created_at DESC
       LIMIT ?`,
    )
    .bind(...bindings, MAX_SAVED_SERVER_ROWS)
    .all<PlayerSavedServerRow>();

  const savedServers = (rows.results ?? []).map((row) => ({
    linked_server_id: row.linked_server_id,
    public_slug: row.public_slug,
    server_name: row.server_name,
    server_type: row.server_type,
    guild_name: row.guild_name,
    guild_icon_url: row.guild_icon_url,
    platform: row.platform,
    map_name: row.map_name,
    public_short_description: row.public_short_description,
    current_players: normalizeNullableNumber(row.current_players),
    max_players: normalizeNullableNumber(row.max_players),
    saved_at: row.saved_at,
  }));

  return {
    savedServerIds: savedServers.map((server) => server.linked_server_id),
    savedServers,
  };
}

export async function savePlayerServer(env: Env, userId: string, linkedServerId: string) {
  const db = requireDb(env);
  const server = await db
    .prepare(
      `SELECT linked_servers.id
       FROM linked_servers
       WHERE linked_servers.id = ?
         AND ${publicSavableServerWhere}
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string }>();

  if (!server) return { saved: false, reason: "server_not_found" as const };

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO player_saved_servers (id, user_id, linked_server_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, linked_server_id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), userId, linkedServerId, now, now)
    .run();

  return { saved: true as const };
}

export async function deletePlayerSavedServer(env: Env, userId: string, linkedServerId: string) {
  const db = requireDb(env);
  await db
    .prepare(
      `DELETE FROM player_saved_servers
       WHERE user_id = ?
         AND linked_server_id = ?`,
    )
    .bind(userId, linkedServerId)
    .run();

  return { saved: false as const };
}

function normalizeNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
