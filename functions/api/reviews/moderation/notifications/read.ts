import { markReviewNotificationsRead } from "../../../../_lib/dzn-pulse";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import { authorizeReviewModerationRequest } from "../../../../_lib/review-moderation-dashboard";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await authorizeReviewModerationRequest(env, request);
  if (!auth.ok) return auth.response;

  const result = await markReviewNotificationsRead(env, auth.actor.user);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};
