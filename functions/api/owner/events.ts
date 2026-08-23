import { getOwnerEventControlPayload } from "../../_lib/owner-events";
import { createCompetitiveEvent, type CreateCompetitiveEventInput } from "../../_lib/events";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { requirePlatformCreatorEventAdmin } from "../../_lib/platform-creator";
import { requirePlatformOwner } from "../../_lib/platform-owner";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (auth.ok === false) return privateOwnerResponse(auth.response);
  return json(await getOwnerEventControlPayload(env, auth.user), { headers: privateNoStoreHeaders() });
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (auth.ok === false) return privateOwnerResponse(auth.response);
  const body = await readJson<CreateCompetitiveEventInput>(request);
  const result = await createCompetitiveEvent(env, auth.user, body);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;

function privateOwnerResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: privateNoStoreHeaders(response.headers),
  });
}
