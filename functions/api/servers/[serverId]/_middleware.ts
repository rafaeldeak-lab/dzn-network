import { ownerAccessErrorResponse, requireOwnerRequestAccess } from "../../../_lib/owner-access";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, next }) => {
  if (request.method === "OPTIONS") return next();

  const access = await requireOwnerRequestAccess(env, request);
  if (!access.allowed) return ownerAccessErrorResponse(access);

  return next();
};
