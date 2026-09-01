import { canManageDiscordGuild, guildIconUrl } from "./discord";
import { requireDb } from "./db";
import type { DiscordGuild, Env } from "./types";

export type PlayerDiscordCommunityRelationship = "member" | "administrator" | "owner";

const MAX_DISCORD_GUILDS_TO_STORE = 200;
const SOURCE_DISCORD_OAUTH_GUILDS = "discord_oauth_guilds";

export async function storePlayerDiscordCommunityMemberships(env: Env, userId: string, guilds: DiscordGuild[]) {
  const db = requireDb(env);
  const memberships = sanitizeDiscordGuilds(guilds).slice(0, MAX_DISCORD_GUILDS_TO_STORE);

  for (const guild of memberships) {
    await db
      .prepare(
        `INSERT INTO player_discord_community_memberships (
          id, user_id, guild_id, guild_name, guild_icon, guild_icon_url, relationship, source,
          first_seen_at, last_seen_at, revoked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, guild_id) DO UPDATE SET
          guild_name = excluded.guild_name,
          guild_icon = excluded.guild_icon,
          guild_icon_url = excluded.guild_icon_url,
          relationship = excluded.relationship,
          source = excluded.source,
          last_seen_at = CURRENT_TIMESTAMP,
          revoked_at = NULL,
          updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        guild.id,
        guild.name,
        guild.icon,
        guildIconUrl(guild),
        relationshipForDiscordGuild(guild),
        SOURCE_DISCORD_OAUTH_GUILDS,
      )
      .run();
  }

  await revokeMissingDiscordCommunityMemberships(db, userId, memberships.map((guild) => guild.id));

  return { stored: memberships.length };
}

export function relationshipForDiscordGuild(guild: Pick<DiscordGuild, "owner" | "permissions">): PlayerDiscordCommunityRelationship {
  if (guild.owner) return "owner";
  if (canManageDiscordGuild(guild)) return "administrator";
  return "member";
}

function sanitizeDiscordGuilds(guilds: DiscordGuild[]) {
  const seen = new Set<string>();
  const sanitized: DiscordGuild[] = [];
  for (const guild of guilds) {
    const id = sanitizeDiscordGuildId(guild.id);
    const name = sanitizeDiscordGuildName(guild.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    sanitized.push({
      id,
      name,
      icon: sanitizeDiscordIconHash(guild.icon),
      owner: Boolean(guild.owner),
      permissions: sanitizeDiscordPermissions(guild.permissions),
    });
  }
  return sanitized;
}

function sanitizeDiscordGuildId(value: unknown) {
  return typeof value === "string" && /^\d{5,32}$/.test(value) ? value : null;
}

function sanitizeDiscordGuildName(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 120) : null;
}

function sanitizeDiscordIconHash(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_]{8,128}$/.test(value) ? value : null;
}

function sanitizeDiscordPermissions(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : "0";
}

async function revokeMissingDiscordCommunityMemberships(db: D1Database, userId: string, activeGuildIds: string[]) {
  if (!activeGuildIds.length) {
    await db
      .prepare(
        `UPDATE player_discord_community_memberships
         SET revoked_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?
           AND revoked_at IS NULL`,
      )
      .bind(userId)
      .run();
    return;
  }

  await db
    .prepare(
      `UPDATE player_discord_community_memberships
       SET revoked_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND revoked_at IS NULL
         AND guild_id NOT IN (${activeGuildIds.map(() => "?").join(", ")})`,
    )
    .bind(userId, ...activeGuildIds)
    .run();
}
