import { listOwnerEventSuggestions } from "../../../_lib/event-suggestions";
import { json, methodNotAllowed } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const result = await listOwnerEventSuggestions(env, auth.user, {
    status: url.searchParams.get("status"),
    limit: url.searchParams.get("limit"),
  });
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
