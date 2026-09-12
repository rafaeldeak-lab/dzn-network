import { requireDb } from "./db";
import { isPlatformOwnerDiscordId } from "./platform-owner";
import type { Env, SessionUser } from "./types";

export type ManagedGameIdentityLink = {
  id: string; user_id: string; discord_id: string; account_name: string | null;
  linked_server_id: string; server_name: string | null; owner_user_id: string;
  player_profile_id: string; player_id: string; player_name: string | null;
  verified_at: string; status: string; revoked_at: string | null; legacy_conflict: number;
};

// A second attribution has no trustworthy write provenance. Never erase it or claim it was revoked.
const legacyConflict = `EXISTS (SELECT 1 FROM player_profiles p
  WHERE (p.id = l.player_profile_id OR (p.linked_server_id = l.linked_server_id AND p.player_id = l.player_id))
    AND p.discord_id IS NOT NULL AND trim(p.discord_id) != '')`;
const liveServer = `lower(COALESCE(s.status, 'pending')) NOT IN ('deleted', 'merged')
  AND (s.merged_into_server_id IS NULL OR s.merged_into_server_id = '')`;
const linkColumns = `l.id, l.user_id, l.discord_id, u.username AS account_name,
  l.linked_server_id, COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
  s.user_id AS owner_user_id, l.player_profile_id, l.player_id, l.player_name,
  l.verified_at, l.status, l.revoked_at, ${legacyConflict} AS legacy_conflict`;
const joins = `FROM player_game_identity_links l JOIN linked_servers s ON s.id = l.linked_server_id
  LEFT JOIN users u ON u.id = l.user_id`;
const opaqueId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(value);

export async function readManagedGameIdentityLinks(env: Env, actor: SessionUser, params: URLSearchParams) {
  const after = params.get("after");
  const id = params.get("link");
  if ((after !== null && !opaqueId(after)) || (id !== null && !opaqueId(id))) {
    return { ok: false as const, status: 400, message: "Invalid link reference." };
  }
  const db = requireDb(env);
  const globalAccess = isPlatformOwnerDiscordId(env, actor.discord_id) ? 1 : 0;
  const rows = await db.prepare(`SELECT ${linkColumns} ${joins}
    WHERE (? = 1 OR s.user_id = ?) AND ${liveServer}
      AND l.status = 'active' AND l.revoked_at IS NULL
      ${id ? "AND l.id = ?" : ""} ${after ? "AND l.id > ?" : ""}
    ORDER BY l.id LIMIT 26`).bind(globalAccess, actor.id, ...(id ? [id] : []), ...(after ? [after] : []))
    .all<ManagedGameIdentityLink>();
  const items = rows.results ?? [];
  return { ok: true as const, items: items.slice(0, 25), next: items.length > 25 ? items[24].id : null };
}

export async function revokePlayerGameIdentityLink(env: Env, actor: SessionUser, linkId: string, input: unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!opaqueId(linkId) || body.confirm !== true || !reason || reason.length > 240 || /[\u0000-\u001f\u007f]/.test(reason)) {
    return { ok: false, status: 400, message: "Confirm the selected link and enter a player-visible reason of 1 to 240 characters." };
  }
  try {
    const db = requireDb(env);
    const link = await db.prepare(`SELECT ${linkColumns} ${joins} WHERE l.id = ? LIMIT 1`)
      .bind(linkId).first<ManagedGameIdentityLink>();
    if (!link) return { ok: false, status: 404, message: "Link not found." };
    const globalAccess = isPlatformOwnerDiscordId(env, actor.discord_id) ? 1 : 0;
    if (!globalAccess && link.owner_user_id !== actor.id) return { ok: false, status: 403, message: "Only this server's owner or the platform owner can revoke this link." };
    if (link.status !== "active" || link.revoked_at !== null) return changed();
    if (link.legacy_conflict) return { ok: false, status: 409, error: "LEGACY_ASSOCIATION_REVIEW_REQUIRED",
      message: "An older account association also exists. Nothing was changed. DZN support must check its evidence before removing it." };
    const decisionId = crypto.randomUUID();
    const gate = `EXISTS (SELECT 1 FROM player_game_identity_audit_log WHERE id = ? AND result = 'accepted')`;
    const sameProfile = `c.linked_server_id = ? AND c.player_profile_id = ? AND c.player_id = ?`;
    const results = await db.batch([
      db.prepare(`UPDATE player_game_identity_links AS l SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE l.id = ? AND l.status = 'active' AND l.revoked_at IS NULL
          AND l.user_id = ? AND l.discord_id = ? AND l.player_profile_id = ? AND l.player_id = ? AND l.linked_server_id = ?
          AND NOT ${legacyConflict}
          AND EXISTS (SELECT 1 FROM linked_servers s WHERE s.id = l.linked_server_id
            AND (? = 1 OR s.user_id = ?) AND ${liveServer})`)
        .bind(link.id, link.user_id, link.discord_id, link.player_profile_id, link.player_id, link.linked_server_id, globalAccess, actor.id),
      db.prepare(`INSERT INTO player_game_identity_audit_log
        (id, link_id, user_id, actor_user_id, linked_server_id, player_profile_id, player_id, action, result, note)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'link_revoked', 'accepted', ? WHERE changes() = 1`)
        .bind(decisionId, link.id, link.user_id, actor.id, link.linked_server_id, link.player_profile_id, link.player_id, reason),
      db.prepare(`INSERT INTO player_game_identity_audit_log
        (id, claim_id, link_id, user_id, actor_user_id, linked_server_id, player_profile_id, player_id, action, result, note)
        SELECT ? || ':' || c.id, c.id, ?, c.user_id, ?, c.linked_server_id, c.player_profile_id, c.player_id,
          'claim_cancelled', 'accepted', 'Pending request closed after link revocation. Submit a new request with current evidence.'
        FROM player_game_identity_claims c WHERE c.status = 'pending' AND ${sameProfile} AND ${gate}`)
        .bind(decisionId, link.id, actor.id, link.linked_server_id, link.player_profile_id, link.player_id, decisionId),
      db.prepare(`UPDATE player_game_identity_claims AS c SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP,
          review_note = 'Link revoked. Submit a new request with current evidence.'
        WHERE c.status = 'pending' AND ${sameProfile} AND ${gate}`)
        .bind(link.linked_server_id, link.player_profile_id, link.player_id, decisionId),
      db.prepare(`INSERT INTO user_notifications
        (id, user_id, server_id, type, title, body, action_url, priority, dedupe_key, metadata)
        SELECT ?, ?, NULL, 'player_link_revoked', 'Game stats link revoked',
          ?,
          '/player/profile', 1, ?, ? WHERE ${gate}`)
        .bind(decisionId, link.user_id, `A server owner or DZN support revoked one of your game stats links. Reason: ${reason}`, `player-link-revoked:${link.id}`,
          JSON.stringify({ link_id: link.id, audit_id: decisionId }), decisionId),
    ]);
    if (results[0].meta.changes !== 1) return changed();
    return { ok: true, status: 200, message: "Link revoked. The player has a private notification. Gameplay records and other server links are unchanged." };
  } catch {
    return { ok: false, status: 503, message: "The link could not be updated. Refresh its current status before trying again." };
  }
}

function changed() {
  return { ok: false, status: 409, message: "This link, its older associations or your server access changed. Refresh before trying again." };
}
