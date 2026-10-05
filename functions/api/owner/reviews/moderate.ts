import { json, methodNotAllowed } from "../../../_lib/http";
import { countUnreadReviewNotifications } from "../../../_lib/dzn-pulse";
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
    return json({ ok: true, filters, ...result, reviewUnreadCount: await countUnreadReviewNotifications(env, auth.user) });
  }
  if (request.method === "POST") {
    if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin review decisions are not allowed." }, { status: 403 });
    const input = await readReviewModerationRequest(request);
    if (!input.ok) return json({ ok: false, message: input.message }, { status: input.status });
    const result = await applyReviewModerationDecision(env, auth.user, input.value);
    return json(result, { status: result.ok ? 200 : result.status });
  }
  return methodNotAllowed();
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
