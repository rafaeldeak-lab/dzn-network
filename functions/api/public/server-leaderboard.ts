import { getPublicServerLeaderboardPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

const PUBLIC_CACHE_HEADERS = {
  "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const serverId = url.searchParams.get("server_id");
  const limit = Number(url.searchParams.get("limit") ?? 10);

  return json(
    await getPublicServerLeaderboardPayload(env, {
      slug,
      serverId,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 10,
    }),
    { headers: PUBLIC_CACHE_HEADERS },
  );
};
