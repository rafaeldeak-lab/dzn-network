import { getPublicServerLeaderboardPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders } from "../../_lib/public-auth";
import { readPublicApiCache, safePublicCacheError, withPublicApiMetadata, writePublicApiCache } from "../../_lib/public-api-cache";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const serverId = url.searchParams.get("server_id");
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  const headers = publicAccessCacheHeaders(viewerLoggedIn);
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 10;
  const cacheKey = `public-server-leaderboard:${viewerLoggedIn ? "full" : "preview"}:${serverId ?? ""}:${slug ?? ""}:${safeLimit}`;

  try {
    const generatedAt = new Date().toISOString();
    const payload = await getPublicServerLeaderboardPayload(env, {
      slug,
      serverId,
      limit: safeLimit,
    }, viewerLoggedIn);
    await writePublicApiCache(env, cacheKey, payload, generatedAt).catch((error) => {
      console.warn("DZN PUBLIC SERVER LEADERBOARD CACHE WRITE FAILED", safePublicCacheError(error));
    });
    return json(withPublicApiMetadata(payload, {
      generated_at: generatedAt,
      source: "live",
      stale: false,
    }), { headers });
  } catch (error) {
    console.warn("DZN PUBLIC SERVER LEADERBOARD CACHE FALLBACK", safePublicCacheError(error));
    const cached = await readPublicApiCache<Record<string, unknown>>(env, cacheKey).catch(() => null);
    if (cached) {
      return json(withPublicApiMetadata(cached.payload, {
        generated_at: cached.generated_at,
        source: "snapshot",
        stale: true,
        error: safePublicCacheError(error),
        fallback_reason: "live_query_failed_using_snapshot",
      }), { headers });
    }
    return json({
      ok: false,
      error: "Public server leaderboard is temporarily unavailable.",
      generated_at: new Date().toISOString(),
      source: "empty_no_cache",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
    }, { headers, status: 503 });
  }
};
