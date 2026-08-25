import { json, methodNotAllowed } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { authorizeReviewModerationRequest, listReviewModerationQueue } from "../../_lib/review-moderation-dashboard";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const auth = await authorizeReviewModerationRequest(env, request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const payload = await listReviewModerationQueue(env, auth.actor, {
      status: url.searchParams.get("status"),
      limit: Number(url.searchParams.get("limit") ?? 40),
    });
    return json(payload, { headers: privateNoStoreHeaders() });
  } catch (error) {
    console.warn("DZN review moderation queue unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "REVIEW_MODERATION_UNAVAILABLE",
        message: "Review moderation queue is temporarily unavailable.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};
