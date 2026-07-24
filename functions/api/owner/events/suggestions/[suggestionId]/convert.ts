import { convertSuggestionToEventDraft } from "../../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readBoundedJson } from "../../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../../_lib/performance";
import { requirePlatformCreatorEventAdmin } from "../../../../../_lib/platform-creator";
import type { PagesFunction } from "../../../../../_lib/types";

type ConvertBody = {
  reason?: string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const body = await readBoundedJson<ConvertBody>(request, 4 * 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await convertSuggestionToEventDraft(env, auth.user, String(params.suggestionId ?? ""), body.value);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
