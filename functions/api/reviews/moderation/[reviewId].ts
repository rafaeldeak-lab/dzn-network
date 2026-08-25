import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { authorizeReviewModerationRequest, moderateReviewFromDashboard } from "../../../_lib/review-moderation-dashboard";
import type { PagesFunction } from "../../../_lib/types";

type ModerationBody = {
  action?: unknown;
  reason?: unknown;
  body?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await authorizeReviewModerationRequest(env, request);
  if (!auth.ok) return auth.response;

  const body = await readBoundedJson<ModerationBody>(request, 4096);
  if (!body.ok) {
    return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  }

  try {
    const result = await moderateReviewFromDashboard(env, auth.actor, String(params.reviewId ?? ""), body.value);
    if (!result.ok) {
      return json(result, { status: result.status, headers: privateNoStoreHeaders() });
    }
    return json(result, { headers: privateNoStoreHeaders() });
  } catch (error) {
    console.warn("DZN review moderation action unavailable", {
      reviewId: String(params.reviewId ?? ""),
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "REVIEW_MODERATION_ACTION_UNAVAILABLE",
        message: "Review moderation action is temporarily unavailable.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};
