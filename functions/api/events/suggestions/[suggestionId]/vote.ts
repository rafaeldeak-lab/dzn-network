import { getSessionUser } from "../../../../_lib/db";
import { voteOnEventSuggestion } from "../../../../_lib/event-suggestions";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

type VoteBody = {
  vote_value?: number | string | null;
  voteValue?: number | string | null;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await getSessionUser(env, request).catch(() => null);
  const body = await readJson<VoteBody>(request);
  const result = await voteOnEventSuggestion(env, user, params.suggestionId, body.vote_value ?? body.voteValue);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
