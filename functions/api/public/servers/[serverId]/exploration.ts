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
    const payload = await getServerAdvancedShowcasePayload(env, serverId, { ownerScoped: false, overlayLimit: 220 });
    if (!payload) {
      return json({ ok: false, error: "server_not_found" }, { status: 404 });
    }
    return json({
      ok: true,
      generated_at: payload.generated_at,
      server: payload.server,
      access: {
        effectivePlan: payload.access.effectivePlan,
        publicMapOverlay: payload.access.publicMapOverlay,
        publicExplorationSummary: payload.access.publicExplorationSummary,
      },
      exploration: payload.exploration,
      notes: [
        "Exploration overlay cells are aggregate grid coverage only.",
        "Raw player coordinates and exact player routes are not exposed publicly.",
      ],
    }, { headers: publicAccessCacheHeaders(viewerLoggedIn) });
  } catch (error) {
    console.warn("DZN SERVER EXPLORATION LOAD FAILED", safeError(error));
    return json({
      ok: false,
      error: "server_exploration_load_failed",
      message: "Server exploration data could not be loaded right now.",
    }, { headers: publicApiErrorHeaders(), status: 503 });
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
