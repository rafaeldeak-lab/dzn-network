import { getOwnerOverview } from "../../_lib/owner-console";
import { json, methodNotAllowed } from "../../_lib/http";
import { requirePlatformOwner } from "../../_lib/platform-owner";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  return json({ ok: true, overview: await getOwnerOverview(env) });
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
