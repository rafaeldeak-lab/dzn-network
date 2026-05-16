import { getPublicLeaderboardsPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

const PUBLIC_CACHE_HEADERS = {
  "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  return json(await getPublicLeaderboardsPayload(env), { headers: PUBLIC_CACHE_HEADERS });
};
