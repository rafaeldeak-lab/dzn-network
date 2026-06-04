import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { PromotionError, recordPromotionClick, recordPromotionImpression } from "../../../_lib/server-promotions";
import type { PagesFunction } from "../../../_lib/types";

type PromotionTrackBody = {
  serverId?: unknown;
  eventType?: unknown;
  source?: unknown;
  promotionId?: unknown;
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = await readJson<PromotionTrackBody>(request);
    const eventType = String(body.eventType ?? "").trim().toLowerCase();
    if (eventType === "impression") {
      await recordPromotionImpression(env, String(body.serverId ?? ""), body.source, body.promotionId);
      return json({ ok: true });
    }
    if (eventType === "click") {
      await recordPromotionClick(env, String(body.serverId ?? ""), body.source, body.promotionId);
      return json({ ok: true });
    }
    return json(errorPayload("PROMOTION_TRACK_EVENT_INVALID", "Promotion tracking event is invalid."), { status: 400 });
  } catch (error) {
    if (error instanceof PromotionError) {
      return json(errorPayload(error.errorCode, error.message), { status: error.status });
    }
    const requestId = crypto.randomUUID();
    console.warn("DZN promotion tracking unavailable", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(errorPayload("PROMOTION_TRACK_UNAVAILABLE", "Promotion tracking is temporarily unavailable.", requestId), { status: 500 });
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
