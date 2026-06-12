import { json, methodNotAllowed } from "../../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../_lib/public-auth";
import { getPublicServerWarDetailPayload } from "../../../_lib/server-wars";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const eventId = sanitizeParam(params.eventId);
  if (!eventId) return json({ ok: false, error: "invalid_event_id" }, { status: 400 });
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  try {
    const payload = await getPublicServerWarDetailPayload(env, eventId);
    if (!payload) return json({ ok: false, error: "server_war_not_found" }, { status: 404 });
    return json(payload, { headers: publicAccessCacheHeaders(viewerLoggedIn) });
  } catch (error) {
    console.warn("DZN SERVER WAR DETAIL LOAD FAILED", safeError(error));
    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      event: null,
      participants: [],
      results: [],
      trophies: [],
      stale: true,
      fallback_reason: "server_war_detail_load_failed",
      message: "This Server War is temporarily unavailable.",
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
