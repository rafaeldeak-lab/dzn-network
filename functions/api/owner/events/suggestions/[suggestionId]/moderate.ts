import { moderateEventSuggestion } from "../../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../../_lib/performance";
import { requirePlatformCreatorEventAdmin } from "../../../../../_lib/platform-creator";
import type { PagesFunction } from "../../../../../_lib/types";

type ModerationBody = {
  action?: string | null;
  reason?: string | null;
  creator_response?: string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const body = await readJson<ModerationBody>(request);
  const result = await moderateEventSuggestion(env, auth.user, params.suggestionId, body);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
