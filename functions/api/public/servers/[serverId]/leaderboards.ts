import { getServerAdvancedShowcasePayload } from "../../../../_lib/advanced-leaderboards";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../../_lib/public-auth";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const serverId = sanitizeParam(params.serverId);
  if (!serverId) {
    return json({ ok: false, error: "invalid_server_id" }, { status: 400 });
  }

  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  try {
    const payload = await getServerAdvancedShowcasePayload(env, serverId, { ownerScoped: false, overlayLimit: 180 });
    if (!payload) {
      return json({ ok: false, error: "server_not_found" }, { status: 404 });
    }
    return json(payload, { headers: publicAccessCacheHeaders(viewerLoggedIn) });
  } catch (error) {
    console.warn("DZN SERVER ADVANCED LEADERBOARDS LOAD FAILED", safeError(error));
    return json({
      ok: true,
      available: false,
      stale: false,
      generated_at: new Date().toISOString(),
      boards: [],
      reason: "server_advanced_leaderboards_temporarily_unavailable",
      message: "Server advanced leaderboard data could not be loaded right now.",
    }, { headers: publicApiErrorHeaders() });
  }
};

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 96);
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
