import { convertSuggestionToEventDraft } from "../../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../../_lib/performance";
import { requirePlatformCreatorEventAdmin } from "../../../../../_lib/platform-creator";
import type { PagesFunction } from "../../../../../_lib/types";

type ConvertBody = {
  reason?: string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const body = await readJson<ConvertBody>(request);
  const result = await convertSuggestionToEventDraft(env, auth.user, params.suggestionId, body);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
