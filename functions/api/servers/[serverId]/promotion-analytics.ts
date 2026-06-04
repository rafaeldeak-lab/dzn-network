import { json, methodNotAllowed } from "../../../_lib/http";
import { getPromotionAnalytics, PromotionError } from "../../../_lib/server-promotions";
import { resolveOwnerVisualLoadoutServer } from "../../../_lib/server-visual-loadouts";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const analytics = await getPromotionAnalytics(env, access.server.id);
    return json({
      ok: true,
      server: {
        id: access.server.id,
        name: access.server.server_name,
        publicSlug: access.server.public_slug,
      },
      ...analytics,
    });
  } catch (error) {
    if (error instanceof PromotionError) {
      return json(errorPayload(error.errorCode, error.message), { status: error.status });
    }
    return unavailableResponse(error, access.server.id);
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});

function errorPayload(errorCode: string, message: string, requestId?: string) {
  return {
    ok: false,
    error: errorCode,
    errorCode,
    message,
    ...(requestId ? { requestId } : {}),
  };
}

function unavailableResponse(error: unknown, serverId: string) {
  const requestId = crypto.randomUUID();
  console.warn("DZN promotion analytics unavailable", {
    requestId,
    serverId,
    error: error instanceof Error ? error.message : "unknown",
  });
  return json(
    errorPayload("PROMOTION_ANALYTICS_UNAVAILABLE", "Promotion results are temporarily unavailable. Please retry.", requestId),
    { status: 500 },
  );
}
