import { requireDb } from "./db";
import { authorizePlatformOwnerUser } from "./platform-owner";
import { ACTIVE_SHOWCASE_GRANT_SQL, NUKETOWN_SHOWCASE_SCOPE, SHOWCASE_SCOPE_SQL, showcaseScopeBindings } from "./server-showcase-access";
import type { Env, SessionUser } from "./types";

type GrantAction = { action: "grant"; requestId: string } | {
  action: "revoke"; grantId: string; reason: "owner_request" | "support_correction";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readShowcaseGrantSupport(env: Env, actor: SessionUser, beforeSequence: number | null = null) {
  if (!authorizePlatformOwnerUser(env, actor).ok) return { status: 403, payload: { ok: false, error: "forbidden" } };
  if (beforeSequence !== null && (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)) return invalidInput();
  const db = requireDb(env);
  const now = new Date().toISOString();
  const current = await db.prepare(ACTIVE_SHOWCASE_GRANT_SQL)
    .bind(...showcaseScopeBindings(), now, now).first<{ id: string; expires_at: string | null }>();
  const grants = await db.prepare(`SELECT id, linked_server_id, owner_user_id, owner_discord_id, guild_id,
      nitrado_service_id, plan_key, purpose, created_by_user_id, created_at, expires_at,
      revoked_at, revoked_by_user_id, revocation_reason
    FROM server_showcase_grants WHERE linked_server_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`)
    .bind(NUKETOWN_SHOWCASE_SCOPE.linkedServerId).all<Record<string, unknown>>();
  const audit = await db.prepare(`SELECT sequence, grant_id, linked_server_id, owner_user_id, owner_discord_id,
      guild_id, nitrado_service_id, action, actor_user_id, reason, created_at
    FROM server_showcase_grant_audit WHERE linked_server_id = ? AND (? IS NULL OR sequence < ?)
    ORDER BY sequence DESC LIMIT 51`)
    .bind(NUKETOWN_SHOWCASE_SCOPE.linkedServerId, beforeSequence, beforeSequence).all<Record<string, unknown>>();
  const auditRows = audit.results ?? [];
  const page = auditRows.slice(0, 50);
  return { status: 200, payload: { ok: true, scope: NUKETOWN_SHOWCASE_SCOPE, effectiveGrantId: current?.id ?? null,
    grants: grants.results ?? [], audit: page, nextAuditCursor: auditRows.length > 50 ? Number(page.at(-1)?.sequence) : null } };
}

export async function changeShowcaseGrant(env: Env, actor: SessionUser, input: GrantAction) {
  if (!authorizePlatformOwnerUser(env, actor).ok) return { status: 403, payload: { ok: false, error: "forbidden" } };
  const db = requireDb(env);
  const now = new Date().toISOString();
  if (input.action === "grant") {
    if (!UUID.test(input.requestId)) return invalidInput();
    // Scope validation, unique reservation and the audit trigger commit in one statement.
    const result = await db.prepare(`INSERT INTO server_showcase_grants (
        id, linked_server_id, owner_user_id, owner_discord_id, guild_id, nitrado_service_id,
        created_by_user_id, created_at)
      SELECT ?, linked_servers.id, linked_servers.user_id, users.discord_id, linked_servers.guild_id,
        linked_servers.nitrado_service_id, ?, ?
      FROM linked_servers JOIN users ON users.id = linked_servers.user_id
      WHERE ${SHOWCASE_SCOPE_SQL}
      ON CONFLICT DO NOTHING`)
      .bind(input.requestId, actor.id, now, ...showcaseScopeBindings()).run();
    const current = await db.prepare(ACTIVE_SHOWCASE_GRANT_SQL)
      .bind(...showcaseScopeBindings(), now, now).first<{ id: string }>();
    if (!current) return { status: 409, payload: { ok: false, error: "SHOWCASE_SCOPE_OR_GRANT_CONFLICT" } };
    return { status: 200, payload: { ok: true, grantId: current.id, changed: Number(result.meta.changes) > 0 } };
  }
  if (input.action !== "revoke" || !UUID.test(input.grantId)
    || !["owner_request", "support_correction"].includes(input.reason)) return invalidInput();
  const result = await db.prepare(`UPDATE server_showcase_grants
    SET revoked_at = ?, revoked_by_user_id = ?, revocation_reason = ?
    WHERE id = ? AND linked_server_id = ? AND revoked_at IS NULL`)
    .bind(now, actor.id, input.reason, input.grantId, NUKETOWN_SHOWCASE_SCOPE.linkedServerId).run();
  const row = await db.prepare(`SELECT revoked_at FROM server_showcase_grants WHERE id = ? AND linked_server_id = ?`)
    .bind(input.grantId, NUKETOWN_SHOWCASE_SCOPE.linkedServerId).first<{ revoked_at: string | null }>();
  if (!row?.revoked_at) return { status: 409, payload: { ok: false, error: "SHOWCASE_GRANT_CONFLICT" } };
  return { status: 200, payload: { ok: true, grantId: input.grantId, changed: Number(result.meta.changes) > 0 } };
}

function invalidInput() { return { status: 400, payload: { ok: false, error: "INVALID_SHOWCASE_ACTION" } }; }
