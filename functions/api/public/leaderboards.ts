import { getPublicLeaderboardsPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders } from "../../_lib/public-auth";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  return json(await getPublicLeaderboardsPayload(env, viewerLoggedIn), { headers: publicAccessCacheHeaders(viewerLoggedIn) });
};
