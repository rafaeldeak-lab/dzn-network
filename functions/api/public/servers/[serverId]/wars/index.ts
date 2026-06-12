import { json, methodNotAllowed } from "../../../../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../../../_lib/public-auth";
import { getPublicServerWarRecordPayload } from "../../../../../_lib/server-wars";
import type { PagesFunction } from "../../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const serverId = sanitizeParam(params.serverId);
  if (!serverId) return json({ ok: false, error: "invalid_server_id" }, { status: 400 });
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  try {
    const payload = await getPublicServerWarRecordPayload(env, serverId);
    if (!payload) return json({ ok: false, error: "server_not_found_or_not_public" }, { status: 404 });
    return json(payload, { headers: publicAccessCacheHeaders(viewerLoggedIn) });
  } catch (error) {
    console.warn("DZN PUBLIC SERVER WAR RECORD LOAD FAILED", safeError(error));
    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      server: null,
      activeEvents: [],
      completedEvents: [],
      trophies: [],
      currentChampionTitles: [],
      stale: true,
      fallback_reason: "public_server_war_record_failed",
    }, { headers: publicApiErrorHeaders() });
  }
};

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 96) : "";
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
