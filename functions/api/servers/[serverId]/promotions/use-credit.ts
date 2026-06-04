import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { PromotionError, usePromotionCredit as spendPromotionCredit } from "../../../../_lib/server-promotions";
import { resolveOwnerVisualLoadoutServer } from "../../../../_lib/server-visual-loadouts";
import type { PagesFunction } from "../../../../_lib/types";

type UsePromotionCreditBody = {
  promotionType?: unknown;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const body = await readJson<UsePromotionCreditBody>(request);
    const status = await spendPromotionCredit(env, access.server.id, body.promotionType, access.user.id);
    return json({
      ok: true,
      message: "Promotion activated.",
      server: {
        id: access.server.id,
        name: access.server.server_name,
        publicSlug: access.server.public_slug,
      },
      ...status,
    });
  } catch (error) {
    if (error instanceof PromotionError) {
      return json(errorPayload(error.errorCode, error.message), { status: error.status });
    }
    return unavailableResponse(error, String(params.serverId ?? ""));
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
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
  console.warn("DZN promotion credit use unavailable", {
    requestId,
    serverId,
    error: error instanceof Error ? error.message : "unknown",
  });
  return json(
    errorPayload("PROMOTION_USE_UNAVAILABLE", "Promotion credit could not be used right now. Please retry.", requestId),
    { status: 500 },
  );
}
