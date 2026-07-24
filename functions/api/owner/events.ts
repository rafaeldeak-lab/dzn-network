import { getOwnerEventControlPayload } from "../../_lib/owner-events";
import { createCompetitiveEvent, type CreateCompetitiveEventInput } from "../../_lib/events";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { requirePlatformCreatorEventAdmin } from "../../_lib/platform-creator";
import { requirePlatformOwner } from "../../_lib/platform-owner";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  return json(await getOwnerEventControlPayload(env, auth.user));
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const body = await readJson<CreateCompetitiveEventInput>(request);
  const result = await createCompetitiveEvent(env, auth.user, body);
  return json(result, { status: result.status });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
