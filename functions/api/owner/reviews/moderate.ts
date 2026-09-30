import { json, methodNotAllowed } from "../../../_lib/http";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import {
  applyReviewModerationDecision,
  parseReviewModerationFilters,
  readReviewModerationQueue,
  readReviewModerationRequest,
} from "../../../_lib/server-review-moderation";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  if (request.method === "GET") {
    const filters = parseReviewModerationFilters(new URL(request.url));
    const result = await readReviewModerationQueue(env, filters);
    return json({ ok: true, filters, ...result });
  }
  if (request.method === "POST") {
    const input = await readReviewModerationRequest(request);
    if (!input.ok) return json({ ok: false, message: input.message }, { status: input.status });
    const result = await applyReviewModerationDecision(env, auth.user, input.value);
    return json(result, { status: result.ok ? 200 : result.status });
  }
  return methodNotAllowed();
};
