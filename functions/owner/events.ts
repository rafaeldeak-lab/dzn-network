import { methodNotAllowed } from "../_lib/http";
import { requirePlatformOwner } from "../_lib/platform-owner";
import type { PagesFunction } from "../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request, next }) => {
  const auth = await requirePlatformOwner(env, request, { mode: "page" });
  if (!auth.ok) return auth.response;
  return next();
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
