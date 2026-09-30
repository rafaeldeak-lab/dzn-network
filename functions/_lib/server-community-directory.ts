import { requireDb } from "./db";
import type { Env, SessionUser } from "./types";
import { SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES, serverLifecycleInSql, serverLifecycleSqlExpression } from "../../lib/server-lifecycle";

type PublicServerRow = {
  id: string;
  public_slug: string;
  server_name: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
};

type PublicMemberRow = {
  id: string;
  handle: string;
  username: string | null;
  discord_id: string | null;
  avatar: string | null;
  discord_identity_enabled: number | null;
  show_display_name: number | null;
  role_label: string | null;
  created_at: string | null;
};

export async function readPublicServerCommunityDirectory(env: Env, rawSlug: unknown) {
  const slug = publicSlug(rawSlug);
  if (!slug) return null;
  const db = requireDb(env);
  const server = await db.prepare(
    `SELECT linked_servers.id, linked_servers.public_slug,
            COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, 'DZN Server') AS server_name,
            discord_guilds.name AS guild_name, discord_guilds.icon_url AS guild_icon_url
     FROM linked_servers
     LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
     WHERE lower(linked_servers.public_slug) = ?
       AND lower(COALESCE(linked_servers.status, 'pending')) = 'live'
       AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
       AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       AND ${serverLifecycleSqlExpression("linked_servers")} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})
     LIMIT 1`,
  ).bind(slug).first<PublicServerRow>();
  if (!server) return null;

  const rows = await db.prepare(
    `SELECT server_community_members.id, player_public_profiles.handle, users.username,
            users.discord_id, users.avatar,
            player_public_discord_identity_preferences.enabled AS discord_identity_enabled,
            player_profile_privacy_preferences.show_display_name,
            server_community_members.role_label, server_community_members.created_at
     FROM server_community_members
     INNER JOIN users ON users.id = server_community_members.user_id
     INNER JOIN player_public_profiles ON player_public_profiles.user_id = users.id
     INNER JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
     LEFT JOIN player_public_discord_identity_preferences ON player_public_discord_identity_preferences.user_id = users.id
     WHERE server_community_members.linked_server_id = ?
       AND server_community_members.public_member_enabled = 1
       AND server_community_members.member_approved_at IS NOT NULL
       AND player_public_profiles.status = 'active'
       AND player_profile_privacy_preferences.public_profile_enabled = 1
      ORDER BY server_community_members.display_order ASC, server_community_members.created_at ASC`,
  ).bind(server.id).all<PublicMemberRow>().catch(() => ({ results: [] as PublicMemberRow[] }));

  return {
    ok: true as const,
    server: {
      public_slug: server.public_slug,
      name: cleanText(server.server_name, 96) ?? "DZN Server",
      href: `/servers/profile?slug=${encodeURIComponent(server.public_slug)}`,
    },
    community: {
      name: cleanText(server.guild_name, 96) ?? cleanText(server.server_name, 96) ?? "DZN Community",
      icon_url: httpsUrl(server.guild_icon_url),
    },
    members: (rows.results ?? []).map((row) => ({
      id: row.id,
      display_name: row.show_display_name === 1 ? cleanText(row.username, 64) ?? "DZN Player" : "DZN Player",
      role_label: cleanText(row.role_label, 36),
      member_since: row.created_at,
      profile: {
        handle: row.handle,
        href: `/players/${encodeURIComponent(row.handle)}`,
        avatar_url: row.discord_identity_enabled === 1 && validDiscordAvatar(row.discord_id, row.avatar)
          ? `/api/public/players/${encodeURIComponent(row.handle)}/avatar`
          : null,
      },
    })),
    safety: {
      opt_in_only: true,
      private_discord_memberships_exposed: false,
      presentation_only: true,
      affects_billing_rankings_reviews_progression_or_eligibility: false,
    },
  };
}

export async function resolvePublishedCommunityMember(env: Env, rawHandle: unknown) {
  const handle = typeof rawHandle === "string" ? rawHandle.trim().toLowerCase() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(handle)) return null;
  return requireDb(env).prepare(
    `SELECT player_public_profiles.user_id, player_public_profiles.handle,
            CASE WHEN player_profile_privacy_preferences.show_display_name = 1 THEN users.username ELSE 'DZN Player' END AS username
     FROM player_public_profiles
     INNER JOIN users ON users.id = player_public_profiles.user_id
     INNER JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
     WHERE player_public_profiles.handle = ?
       AND player_public_profiles.status = 'active'
       AND player_profile_privacy_preferences.public_profile_enabled = 1
     LIMIT 1`,
  ).bind(handle).first<{ user_id: string; handle: string; username: string | null }>();
}

export async function addCommunityMember(env: Env, actor: SessionUser, linkedServerId: string, memberUserId: string, roleLabel: unknown, publish: unknown) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const role = cleanText(roleLabel, 36);
  const enabled = publish === true ? 1 : 0;
  const existing = await db.prepare(
    "SELECT id FROM server_community_members WHERE linked_server_id = ? AND user_id = ? LIMIT 1",
  ).bind(linkedServerId, memberUserId).first<{ id: string }>();
  if (existing) {
    await updateExistingCommunityMember(db, actor, linkedServerId, existing.id, memberUserId, role, enabled, now);
    return { role_label: role, public_member_enabled: enabled === 1 };
  }
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO server_community_members (id, linked_server_id, user_id, role_label, public_member_enabled, source, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'owner_public_handle', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), linkedServerId, memberUserId, role, enabled, actor.id, now, now),
      db.prepare(
        `INSERT INTO server_community_member_audit (id, linked_server_id, member_user_id, actor_user_id, action, role_label, public_member_enabled, created_at)
         VALUES (?, ?, ?, ?, 'add', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), linkedServerId, memberUserId, actor.id, role, enabled, now),
    ]);
  } catch (error) {
    const concurrent = await db.prepare(
      "SELECT id FROM server_community_members WHERE linked_server_id = ? AND user_id = ? LIMIT 1",
    ).bind(linkedServerId, memberUserId).first<{ id: string }>();
    if (!concurrent) throw error;
    await updateExistingCommunityMember(db, actor, linkedServerId, concurrent.id, memberUserId, role, enabled, now);
  }
  return { role_label: role, public_member_enabled: enabled === 1 };
}

async function updateExistingCommunityMember(
  db: D1Database,
  actor: SessionUser,
  linkedServerId: string,
  memberId: string,
  memberUserId: string,
  role: string | null,
  enabled: number,
  now: string,
) {
  await db.batch([
    db.prepare(
      "UPDATE server_community_members SET role_label = ?, public_member_enabled = ?, updated_at = ? WHERE id = ? AND linked_server_id = ?",
    ).bind(role, enabled, now, memberId, linkedServerId),
    db.prepare(
      `INSERT INTO server_community_member_audit (id, linked_server_id, member_user_id, actor_user_id, action, role_label, public_member_enabled, created_at)
       VALUES (?, ?, ?, ?, 'update', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), linkedServerId, memberUserId, actor.id, role, enabled, now),
  ]);
}

export async function listManagedCommunityMembers(env: Env, linkedServerId: string) {
  const result = await requireDb(env).prepare(
    `SELECT server_community_members.id, server_community_members.user_id, server_community_members.role_label,
            server_community_members.public_member_enabled, server_community_members.member_approved_at, server_community_members.source,
            server_community_members.created_at, server_community_members.updated_at,
            player_public_profiles.handle,
            CASE WHEN player_profile_privacy_preferences.show_display_name = 1 THEN users.username ELSE 'DZN Player' END AS username
     FROM server_community_members
     INNER JOIN users ON users.id = server_community_members.user_id
     INNER JOIN player_public_profiles ON player_public_profiles.user_id = users.id
     INNER JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
     WHERE server_community_members.linked_server_id = ?
     ORDER BY server_community_members.updated_at DESC`,
  ).bind(linkedServerId).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function updateCommunityMember(env: Env, actor: SessionUser, linkedServerId: string, memberId: string, publish: unknown) {
  const db = requireDb(env);
  const existing = await db.prepare(
    "SELECT user_id, role_label FROM server_community_members WHERE id = ? AND linked_server_id = ? LIMIT 1",
  ).bind(memberId, linkedServerId).first<{ user_id: string; role_label: string | null }>();
  if (!existing) return false;
  const enabled = publish === true ? 1 : 0;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE server_community_members SET public_member_enabled = ?, updated_at = ? WHERE id = ? AND linked_server_id = ?")
      .bind(enabled, now, memberId, linkedServerId),
    db.prepare(
      `INSERT INTO server_community_member_audit (id, linked_server_id, member_user_id, actor_user_id, action, role_label, public_member_enabled, created_at)
       VALUES (?, ?, ?, ?, 'update', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), linkedServerId, existing.user_id, actor.id, existing.role_label, enabled, now),
  ]);
  return true;
}

export async function removeCommunityMember(env: Env, actor: SessionUser, linkedServerId: string, memberId: string) {
  const db = requireDb(env);
  const existing = await db.prepare(
    "SELECT user_id, role_label, public_member_enabled FROM server_community_members WHERE id = ? AND linked_server_id = ? LIMIT 1",
  ).bind(memberId, linkedServerId).first<{ user_id: string; role_label: string | null; public_member_enabled: number }>();
  if (!existing) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO server_community_member_audit (id, linked_server_id, member_user_id, actor_user_id, action, role_label, public_member_enabled, created_at)
       VALUES (?, ?, ?, ?, 'remove', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), linkedServerId, existing.user_id, actor.id, existing.role_label, existing.public_member_enabled, now),
    db.prepare("DELETE FROM server_community_members WHERE id = ? AND linked_server_id = ?").bind(memberId, linkedServerId),
  ]);
  return true;
}

export async function listPlayerCommunityDirectoryInvites(env: Env, userId: string) {
  const result = await requireDb(env).prepare(
    `SELECT server_community_members.id, server_community_members.role_label,
            server_community_members.public_member_enabled, server_community_members.member_approved_at,
            server_community_members.created_at, server_community_members.updated_at,
            COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, 'DZN Server') AS server_name,
            linked_servers.public_slug
     FROM server_community_members
     INNER JOIN linked_servers ON linked_servers.id = server_community_members.linked_server_id
     WHERE server_community_members.user_id = ?
       AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
     ORDER BY server_community_members.updated_at DESC`,
  ).bind(userId).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function decidePlayerCommunityDirectoryInvite(env: Env, actor: SessionUser, memberId: string, approve: boolean) {
  const db = requireDb(env);
  const existing = await db.prepare(
    "SELECT linked_server_id, role_label, public_member_enabled FROM server_community_members WHERE id = ? AND user_id = ? LIMIT 1",
  ).bind(memberId, actor.id).first<{ linked_server_id: string; role_label: string | null; public_member_enabled: number }>();
  if (!existing) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE server_community_members SET member_approved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(approve ? now : null, now, memberId, actor.id),
    db.prepare(
      `INSERT INTO server_community_member_audit (id, linked_server_id, member_user_id, actor_user_id, action, role_label, public_member_enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), existing.linked_server_id, actor.id, actor.id, approve ? "approve" : "revoke", existing.role_label, existing.public_member_enabled, now),
  ]);
  return true;
}

function publicSlug(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/.test(text) ? text : null;
}

function cleanText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, max) || null;
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
}

function validDiscordAvatar(discordId: string | null, avatar: string | null) {
  return Boolean(discordId && /^\d{16,22}$/.test(discordId) && avatar && /^[a-zA-Z0-9_]{8,128}$/.test(avatar));
}
