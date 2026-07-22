import { getSessionUser } from "../../../../_lib/db";
import { voteOnEventSuggestion } from "../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readBoundedJson } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

type VoteBody = {
  vote_value?: number | string | null;
  voteValue?: number | string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await getSessionUser(env, request).catch(() => null);
  const body = await readBoundedJson<VoteBody>(request, 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await voteOnEventSuggestion(env, user, String(params.suggestionId ?? ""), body.value.vote_value ?? body.value.voteValue);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
