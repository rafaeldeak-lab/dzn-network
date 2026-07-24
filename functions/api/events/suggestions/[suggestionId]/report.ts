import { getSessionUser } from "../../../../_lib/db";
import { reportEventSuggestion, unauthorizedSuggestionMutationPayload } from "../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readBoundedJson } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

type ReportBody = {
  reason?: string | null;
  note?: string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await getSessionUser(env, request).catch(() => null);
  if (!user) {
    const result = unauthorizedSuggestionMutationPayload("report");
    return json(result, { status: result.status, headers: privateNoStoreHeaders() });
  }
  const body = await readBoundedJson<ReportBody>(request, 2 * 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await reportEventSuggestion(env, user, String(params.suggestionId ?? ""), body.value);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
