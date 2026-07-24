import { getOwnerEventDraftReviewPayload } from "../../../_lib/owner-events";
import { json, methodNotAllowed } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformCreatorEventAdmin } from "../../../_lib/platform-creator";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const result = await getOwnerEventDraftReviewPayload(env, String(params.slug ?? ""));
  return json(result, { status: result.ok ? 200 : result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
