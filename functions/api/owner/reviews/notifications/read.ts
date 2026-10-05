import { countUnreadReviewNotifications, markReviewNotificationsRead, PULSE_NO_STORE_HEADERS } from "../../../../_lib/dzn-pulse";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requirePlatformOwner } from "../../../../_lib/platform-owner";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  const result = await markReviewNotificationsRead(env, auth.user);
  return json(result, { status: result.status, headers: PULSE_NO_STORE_HEADERS });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  return json({ ok: true, reviewUnreadCount: await countUnreadReviewNotifications(env, auth.user) }, { headers: PULSE_NO_STORE_HEADERS });
};

export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestPut = onRequestPatch;
export const onRequestDelete = onRequestPatch;
