import { getSessionUser, requireDb } from "../../../../_lib/db";
import { dispatchUnifiedRegistrationEmbed } from "../../../../_lib/ctf-tournaments";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

type RegistrationEmbedBody = {
  opponent_name?: string;
  target_metric?: string;
  tournament_id?: string;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  const linkedServerId = sanitizeServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });
  const owned = await requireOwnedServer(env, user, linkedServerId);
  if (!owned) return json({ error: "Server not found" }, { status: 404 });
  const body = await readJson<RegistrationEmbedBody>(request);
  const opponentName = cleanText(body.opponent_name, "Matched opponent");
  const result = await dispatchUnifiedRegistrationEmbed(env, linkedServerId, {
    opponentName,
    targetMetric: body.target_metric,
    tournamentId: cleanOptional(body.tournament_id),
  });
  return json(result, { status: result.ok ? 200 : 409 });
};

async function requireOwnedServer(env: Env, user: SessionUser, linkedServerId: string) {
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

function cleanText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 120) : fallback;
}

function cleanOptional(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 80) : null;
}
