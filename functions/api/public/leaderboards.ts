import { getPublicLeaderboardsPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders } from "../../_lib/public-auth";
import { readPublicApiCache, safePublicCacheError, withPublicApiMetadata, writePublicApiCache } from "../../_lib/public-api-cache";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  const headers = publicAccessCacheHeaders(viewerLoggedIn);
  const cacheKey = `public-leaderboards:${viewerLoggedIn ? "full" : "preview"}`;
  try {
    const generatedAt = new Date().toISOString();
    const payload = await getPublicLeaderboardsPayload(env, viewerLoggedIn);
    await writePublicApiCache(env, cacheKey, payload, generatedAt).catch((error) => {
      console.warn("DZN PUBLIC LEADERBOARDS CACHE WRITE FAILED", safePublicCacheError(error));
    });
    return json(withPublicApiMetadata(payload, {
      generated_at: generatedAt,
      source: "live",
      stale: false,
    }), { headers });
  } catch (error) {
    console.warn("DZN PUBLIC LEADERBOARDS CACHE FALLBACK", safePublicCacheError(error));
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
      error: "Public leaderboards are temporarily unavailable.",
      generated_at: new Date().toISOString(),
      source: "empty_no_cache",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
    }, { headers, status: 503 });
  }
};
