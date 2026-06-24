import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { getOwnerServerWarsPayload } from "../../../../_lib/server-wars";
import type { PagesFunction } from "../../../../_lib/types";

const PRIVATE_HEADERS = { "cache-control": "private, max-age=20" };

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const serverId = sanitizeParam(params.serverId);
  if (!serverId) return json({ ok: false, error: "invalid_server_id" }, { status: 400 });
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "unauthenticated" }, { status: 401 });
  try {
    const payload = await getOwnerServerWarsPayload(env, user, serverId, { skipSchemaEnsure: true });
    if (!payload.ok) return json({ ok: false, error: payload.error }, { status: payload.status });
    return json(payload, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.warn("DZN OWNER SERVER WARS LOAD FAILED", safeError(error));
    return json({
      ok: true,
      available: false,
      generated_at: new Date().toISOString(),
      events: [],
      active_events: [],
      pendingChallenges: [],
      pending_challenges: [],
      trophies: [],
      currentChampionTitles: [],
      reason: "server_wars_temporarily_unavailable",
    }, { headers: PRIVATE_HEADERS });
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 96) : "";
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
