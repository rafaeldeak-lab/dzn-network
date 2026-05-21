import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { processServerMatchmakingOptIn } from "../../../../_lib/ctf-tournaments";
import type { PagesFunction, SessionUser } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  const linkedServerId = sanitizeServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });
  const owned = await requireOwnedServer(env, user, linkedServerId);
  if (!owned) return json({ error: "Server not found" }, { status: 404 });
  const result = await processServerMatchmakingOptIn(env, linkedServerId);
  return json(result, { status: result.ok ? 200 : result.status === "plan_locked" ? 403 : 404 });
};

async function requireOwnedServer(env: Parameters<PagesFunction>[0]["env"], user: SessionUser, linkedServerId: string) {
  const row = await requireDb(env)
    .prepare("SELECT id FROM linked_servers WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(linkedServerId, user.id)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

function sanitizeServerId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{8,80}$/.test(text) ? text : null;
}
