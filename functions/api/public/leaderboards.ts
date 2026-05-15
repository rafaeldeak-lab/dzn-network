import { getPublicLeaderboardsPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  return json(await getPublicLeaderboardsPayload(env));
};
