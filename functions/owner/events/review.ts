import { methodNotAllowed } from "../../_lib/http";
import { requirePlatformCreatorEventAdmin } from "../../_lib/platform-creator";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request, next }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request, { mode: "page" });
  if (!auth.ok) return auth.response;
  return next();
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
