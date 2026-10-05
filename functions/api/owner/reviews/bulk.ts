import { PULSE_NO_STORE_HEADERS } from "../../../_lib/dzn-pulse";
import { json, methodNotAllowed } from "../../../_lib/http";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import { applyBulkReviewModerationDecision, readReviewModerationBulkRequest } from "../../../_lib/server-review-moderation";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin review decisions are not allowed." }, { status: 403, headers: PULSE_NO_STORE_HEADERS });
  const input = await readReviewModerationBulkRequest(request);
  if (!input.ok) return json({ ok: false, message: input.message }, { status: input.status, headers: PULSE_NO_STORE_HEADERS });
  const result = await applyBulkReviewModerationDecision(env, auth.user, input.value);
  return json(result, { status: result.ok ? 200 : result.status, headers: PULSE_NO_STORE_HEADERS });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPatch = onRequestGet;
export const onRequestPut = onRequestGet;
export const onRequestDelete = onRequestGet;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
