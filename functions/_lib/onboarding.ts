import { decryptToken, encryptToken } from "./crypto";
import { requireDb } from "./db";
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

export async function storePendingNitradoToken(env: Env, userId: number, token: string) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const encrypted = await encryptToken(token, env.TOKEN_ENCRYPTION_KEY);
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO nitrado_connections (
        user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(userId, encrypted.encryptedToken, encrypted.iv, encrypted.authTag)
    .run();
}

export async function getLatestNitradoToken(env: Env, userId: number) {
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

export async function linkLatestNitradoConnection(env: Env, userId: number, linkedServerId: number) {
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
