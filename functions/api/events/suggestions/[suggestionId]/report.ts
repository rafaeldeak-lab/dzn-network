import { getSessionUser } from "../../../../_lib/db";
import { reportEventSuggestion } from "../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

type ReportBody = {
  reason?: string | null;
  note?: string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await getSessionUser(env, request).catch(() => null);
  const body = await readJson<ReportBody>(request);
  const result = await reportEventSuggestion(env, user, params.suggestionId, body);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
