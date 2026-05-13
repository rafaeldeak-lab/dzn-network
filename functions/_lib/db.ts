import { hmacSha256, randomToken } from "./crypto";
import { mockGuilds, mockUser } from "./mock";
import type { D1DatabaseLike, DiscordGuild, DiscordUser, Env, SessionUser } from "./types";

export const SESSION_COOKIE = "dzn_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function requireDb(env: Env): D1DatabaseLike {
  if (!env.DB) throw new Error("D1 DB binding is not configured");
  return env.DB;
}

export async function upsertUser(env: Env, user: DiscordUser) {
  const db = requireDb(env);
  const existing = await db
    .prepare("SELECT id FROM users WHERE discord_id = ?")
    .bind(user.id)
    .first<{ id: number }>();

  if (existing) {
    await db
      .prepare(
        "UPDATE users SET username = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?",
      )
      .bind(user.username, user.avatar, user.id)
      .run();
    return existing.id;
  }

  const result = await db
    .prepare(
      "INSERT INTO users (discord_id, username, avatar, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
    )
    .bind(user.id, user.username, user.avatar)
    .first<{ id: number }>();

  if (!result) throw new Error("Failed to create user");
  return result.id;
}

export async function storeGuilds(env: Env, ownerUserId: number, guilds: DiscordGuild[]) {
  const db = requireDb(env);
  for (const guild of guilds) {
    const iconUrl = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
      : null;
    await db
      .prepare(
        `INSERT INTO discord_guilds (
          guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(guild_id, owner_user_id) DO UPDATE SET
          name = excluded.name,
          icon = excluded.icon,
          icon_url = excluded.icon_url,
          permissions = excluded.permissions,
          is_owner = excluded.is_owner,
          updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(guild.id, ownerUserId, guild.name, guild.icon, iconUrl, guild.permissions, guild.owner ? 1 : 0)
      .run();
  }
}

export async function createSession(env: Env, userId: number) {
  const db = requireDb(env);
  const rawToken = randomToken(48);
  const secret = env.SESSION_SECRET || "dev-session-secret";
  const tokenHash = await hmacSha256(rawToken, secret);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO sessions (user_id, session_token_hash, expires_at, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(userId, tokenHash, expiresAt)
    .run();

  return { token: rawToken, maxAge: SESSION_TTL_SECONDS };
}

export async function getSessionUser(env: Env, request: Request): Promise<SessionUser | null> {
  const { readCookie } = await import("./http");
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!sessionToken) return null;

  const db = requireDb(env);
  const tokenHash = await hmacSha256(sessionToken, env.SESSION_SECRET || "dev-session-secret");
  return db
    .prepare(
      `SELECT users.id, users.discord_id, users.username, users.avatar
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.session_token_hash = ? AND sessions.expires_at > datetime('now')
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<SessionUser>();
}

export async function destroySession(env: Env, request: Request) {
  const { readCookie } = await import("./http");
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!sessionToken || !env.DB) return;
  const tokenHash = await hmacSha256(sessionToken, env.SESSION_SECRET || "dev-session-secret");
  await env.DB.prepare("DELETE FROM sessions WHERE session_token_hash = ?").bind(tokenHash).run();
}

export async function ensureMockUser(env: Env) {
  const userId = await upsertUser(env, mockUser);
  await storeGuilds(env, userId, mockGuilds);
  return { userId, user: mockUser };
}

export async function getCurrentLinkedServer(env: Env, userId: number) {
  if (!env.DB) return null;
  return env.DB
    .prepare(
      `SELECT linked_servers.*, discord_guilds.name AS guild_name, discord_guilds.icon_url AS guild_icon_url
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE linked_servers.user_id = ?
       ORDER BY linked_servers.updated_at DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first();
}
