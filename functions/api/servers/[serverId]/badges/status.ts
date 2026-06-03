import { isDznAdminDiscordId } from "../../../../_lib/admin";
import { ensureBadgeEvaluationSchema } from "../../../../_lib/badge-evaluation";
import { getEarnedServerBadges, getLockedServerBadges } from "../../../../_lib/badge-awards";
import { ensureMockUser, getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { isMockAuth } from "../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", errorCode: "NOT_AUTHENTICATED", message: "Log in to view badge status." }, { status: 401 });
  const serverId = sanitizeServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", errorCode: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });

  try {
    const server = await resolveOwnedServer(env, user, serverId);
    if (!server) return json({ ok: false, error: "SERVER_NOT_FOUND", errorCode: "SERVER_NOT_FOUND", message: "Server not found." }, { status: 404 });

    await ensureBadgeEvaluationSchema(env);
    const [earned, locked, lastEvaluation] = await Promise.all([
      getEarnedServerBadges(env, server.id).catch(() => []),
      getLockedServerBadges(env, server.id).catch(() => []),
      getLastEvaluationAt(env, server.id),
    ]);

    return json({
      ok: true,
      serverId: server.id,
      earnedCount: earned.length,
      lockedCount: locked.length,
      lastEvaluationAt: lastEvaluation,
      nextEvaluationEstimate: "Next safe badge batch",
      ownerCanGrantProtectedBadges: false,
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN owner badge status unavailable", { requestId, serverId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "BADGE_STATUS_UNAVAILABLE",
      errorCode: "BADGE_STATUS_UNAVAILABLE",
      message: "Badge status is temporarily unavailable.",
      requestId,
    }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

async function resolveOwnedServer(env: Env, user: SessionUser, rawServerId: string) {
  const admin = isDznAdminDiscordId(env, user.discord_id) || isMockAuth(env.MOCK_AUTH);
  const db = requireDb(env);
  if (admin) {
    return db
      .prepare("SELECT id FROM linked_servers WHERE id = ? OR nitrado_service_id = ? OR public_slug = ? LIMIT 1")
      .bind(rawServerId, rawServerId, rawServerId)
      .first<{ id: string }>();
  }
  return db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE (id = ? OR nitrado_service_id = ? OR public_slug = ?)
         AND user_id = ?
       LIMIT 1`,
    )
    .bind(rawServerId, rawServerId, rawServerId, user.id)
    .first<{ id: string }>();
}

async function getLastEvaluationAt(env: Env, serverId: string) {
  try {
    const row = await requireDb(env)
      .prepare(
        `SELECT MAX(created_at) AS last_evaluation_at
         FROM badge_audit_log
         WHERE server_id = ?
           AND action IN ('evaluation_ran', 'badge_progress_updated', 'badge_awarded', 'crown_transferred')`,
      )
      .bind(serverId)
      .first<{ last_evaluation_at: string | null }>();
    return row?.last_evaluation_at ?? null;
  } catch {
    return null;
  }
}

function sanitizeServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{3,120}$/.test(value) ? value : "";
}
