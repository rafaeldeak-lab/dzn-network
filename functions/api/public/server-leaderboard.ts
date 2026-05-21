import { getPublicServerLeaderboardPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../_lib/public-auth";
import {
  logPublicApi503RootCause,
  logPublicApiLoadFailed,
  logPublicApiSnapshotFallbackServed,
  publicApiSnapshotAccess,
  publicApiSnapshotFallbackHeaders,
  publicApiSnapshotKey,
  readPublicApiCache,
  safePublicCacheError,
  withPublicApiMetadata,
  writePublicApiCache,
} from "../../_lib/public-api-cache";
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
  const accessLevel = publicApiSnapshotAccess(viewerLoggedIn);
  const cacheSuffix = serverId || slug || safeLimit !== 10 ? `${serverId ?? ""}:${slug ?? ""}:${safeLimit}` : null;
  const cacheKey = publicApiSnapshotKey("server-leaderboard", accessLevel, cacheSuffix);
  const endpoint = "/api/public/server-leaderboard";
  const requestId = request.headers.get("cf-ray");

  try {
    const generatedAt = new Date().toISOString();
    const payload = await getPublicServerLeaderboardPayload(env, {
      slug,
      serverId,
      limit: safeLimit,
    }, viewerLoggedIn);
    await writePublicApiCache(env, cacheKey, payload, generatedAt, accessLevel).catch((error) => {
      console.warn("DZN PUBLIC SERVER LEADERBOARD CACHE WRITE FAILED", safePublicCacheError(error));
    });
    return json(withPublicApiMetadata(payload, {
      generated_at: generatedAt,
      source: "live",
      stale: false,
    }), { headers });
  } catch (error) {
    logPublicApiLoadFailed(endpoint, 503, error, requestId);
    const cached = await readPublicApiCache<Record<string, unknown>>(env, cacheKey).catch(() => null);
    if (cached) {
      logPublicApiSnapshotFallbackServed(endpoint, cacheKey, requestId);
      return json(withPublicApiMetadata(cached.payload, {
        generated_at: cached.generated_at,
        source: "snapshot",
        stale: true,
        fallback_reason: "live_query_failed_using_snapshot",
        snapshot_generated_at: cached.generated_at,
        message: "Showing last known data while live refresh recovers.",
      }), { headers: publicApiSnapshotFallbackHeaders(viewerLoggedIn) });
    }
    logPublicApi503RootCause(endpoint, error, requestId, "server_leaderboard_live_query");
    return json({
      ok: false,
      error: "public_server_leaderboard_load_failed",
      message: "Unable to load this server leaderboard right now.",
      generated_at: new Date().toISOString(),
      source: "empty_no_cache",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
      retry_after_seconds: 10,
    }, { headers: publicApiErrorHeaders(), status: 503 });
  }
};
