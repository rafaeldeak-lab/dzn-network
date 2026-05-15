import { decryptToken, encryptToken } from "./crypto";
import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import type { Env, NitradoService, ServerType } from "./types";

export const serverTypes: ServerType[] = ["PVP", "DEATHMATCH", "PVE", "PVP / PVE"];
export const allowedTags = [
  "Raid Focused",
  "Factions",
  "Base Building",
  "Trader / Economy",
  "Events",
  "Survival",
  "Hardcore",
  "No Base Decay",
  "Custom Maps",
  "Weekend Raids",
  "KOS",
  "Active Admins",
  "New Player Friendly",
  "Roleplay",
  "Modded",
];

export function validateServerType(value: string): value is ServerType {
  return serverTypes.includes(value as ServerType);
}

export function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string" && allowedTags.includes(tag))
    .slice(0, 5);
}

export function publicSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || `server-${Date.now()}`;
}

export async function uniquePublicSlug(env: Env, name: string, linkedServerId?: string) {
  const db = requireDb(env);
  const base = publicSlug(name);
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await db
      .prepare("SELECT id FROM linked_servers WHERE public_slug = ? LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();
    if (!existing || existing.id === linkedServerId) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function ensureDraftLinkedServer(
  env: Env,
  userId: string,
  discordGuildId: string,
  serverType: ServerType,
  tags: string[],
) {
  const db = requireDb(env);
  const guild = await db
    .prepare("SELECT id, guild_id FROM discord_guilds WHERE guild_id = ? AND owner_user_id = ? LIMIT 1")
    .bind(discordGuildId, userId)
    .first<{ id: string; guild_id: string }>();

  if (!guild) throw new Error("Discord guild not found");

  const existingDraft = await db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE user_id = ?
         AND lower(COALESCE(status, 'pending')) = 'pending'
         AND (nitrado_service_id IS NULL OR nitrado_service_id = '')
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string }>();

  if (existingDraft) {
    await db
      .prepare(
        `UPDATE linked_servers SET
          guild_id = ?,
          discord_guild_id = ?,
          server_name = ?,
          server_type = ?,
          tags_json = ?,
          status = 'pending',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .bind(guild.guild_id, guild.id, "Pending Nitrado Service", serverType, JSON.stringify(tags), existingDraft.id)
      .run();
    return existingDraft.id;
  }

  const linkedServerId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO linked_servers (
        id, user_id, guild_id, discord_guild_id, server_name, server_type, tags_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      linkedServerId,
      userId,
      guild.guild_id,
      guild.id,
      "Pending Nitrado Service",
      serverType,
      JSON.stringify(tags),
    )
    .run();

  return linkedServerId;
}

export async function getServerLinkLimitForUser(env: Env, userId: string) {
  void env;
  void userId;
  return null as number | null;
}

export async function countLinkedServersForUser(env: Env, userId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM linked_servers
       WHERE user_id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')`,
    )
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function storePendingNitradoToken(env: Env, userId: string, linkedServerId: string, token: string) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const encrypted = await encryptToken(token, env.TOKEN_ENCRYPTION_KEY);
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO nitrado_connections (
        id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(crypto.randomUUID(), userId, linkedServerId, encrypted.encryptedToken, encrypted.iv, encrypted.authTag)
    .run();
}

export async function getLatestNitradoToken(env: Env, userId: string) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();

  if (!row) return null;
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

export async function linkLatestNitradoConnection(env: Env, userId: string, linkedServerId: string) {
  const db = requireDb(env);
  await db
    .prepare(
      `UPDATE nitrado_connections
       SET linked_server_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM nitrado_connections
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1
       )`,
    )
    .bind(linkedServerId, userId)
    .run();
}

export function findService(services: NitradoService[], id: string) {
  return services.find((service) => service.id === id) ?? null;
}

export async function saveLinkedServerNitradoService(
  env: Env,
  linkedServerId: string,
  service: NitradoService,
  serverType: ServerType,
  tags: string[],
) {
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  const draft = await db
    .prepare("SELECT id, user_id, guild_id, discord_guild_id FROM linked_servers WHERE id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<{ id: string; user_id: string; guild_id: string; discord_guild_id: string }>();
  if (!draft) throw new Error("Linked server draft not found");

  const existingService = await db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE nitrado_service_id = ?
         AND id != ?
         AND lower(COALESCE(status, 'pending')) != 'merged'
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       ORDER BY
         CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN 0 ELSE 1 END,
         updated_at DESC,
         created_at DESC
       LIMIT 1`,
    )
    .bind(service.id, linkedServerId)
    .first<{ id: string }>();

  const targetLinkedServerId = existingService?.id ?? linkedServerId;
  const slug = await uniquePublicSlug(env, service.name, targetLinkedServerId);
  await db
    .prepare(
      `UPDATE linked_servers SET
        user_id = ?,
        guild_id = ?,
        discord_guild_id = ?,
        nitrado_service_id = ?,
        nitrado_service_name = ?,
        server_name = ?,
        server_type = ?,
        tags_json = ?,
        region = ?,
        game = ?,
        platform = ?,
        ip_address = ?,
        player_slots = ?,
        status = CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN status ELSE 'pending' END,
        public_slug = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(
      draft.user_id,
      draft.guild_id,
      draft.discord_guild_id,
      service.id,
      service.name,
      service.name,
      serverType,
      JSON.stringify(tags),
      service.ipAddress ?? service.region ?? null,
      service.game ?? null,
      service.platform ?? null,
      service.ipAddress ?? null,
      service.playerSlots ?? null,
      slug,
      targetLinkedServerId,
    )
    .run();

  if (existingService) {
    await db
      .prepare(
        `DELETE FROM linked_servers
         WHERE id = ?
           AND user_id = ?
           AND lower(COALESCE(status, 'pending')) = 'pending'
           AND (nitrado_service_id IS NULL OR nitrado_service_id = '')`,
      )
      .bind(linkedServerId, draft.user_id)
      .run();
  }

  return targetLinkedServerId;
}
