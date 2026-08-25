import { createCategorySafeMatchmaking } from "../../_lib/events";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { ownerAccessErrorResponse, requireOwnerRequestAccess } from "../../_lib/owner-access";
import type { PagesFunction } from "../../_lib/types";

type MatchmakingBody = {
  server_id?: string;
  opponent_server_id?: string;
  event_slug?: string;
  event_type?: string;
  preview?: boolean;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const ownerAccess = await requireOwnerRequestAccess(env, request);
  if (!ownerAccess.allowed) return ownerAccessErrorResponse(ownerAccess);
  const viewer = ownerAccess.user;
  const body = await readJson<MatchmakingBody>(request);
  const result = await createCategorySafeMatchmaking(env, viewer, body);
  return json(result, { status: result.status });
};
