import { applyLeaderboardsAccess, emptyPublicLeaderboards, getPublicLeaderboardsPayload } from "../../_lib/public-leaderboards";
import { json, methodNotAllowed } from "../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders } from "../../_lib/public-auth";
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
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  const headers = publicAccessCacheHeaders(viewerLoggedIn);
  const accessLevel = publicApiSnapshotAccess(viewerLoggedIn);
  const requestUrl = new URL(request.url);
  const leaderboardOptions = parseLeaderboardOptions(requestUrl.searchParams);
  const cacheSuffix = leaderboardOptions.full
    ? `full:${leaderboardOptions.metric}:p${leaderboardOptions.page}:s${leaderboardOptions.pageSize}`
    : null;
  const cacheKey = publicApiSnapshotKey("leaderboards", accessLevel, cacheSuffix);
  const endpoint = "/api/public/leaderboards";
  const requestId = request.headers.get("cf-ray");
  try {
    const generatedAt = new Date().toISOString();
    const payload = await getPublicLeaderboardsPayload(env, viewerLoggedIn, leaderboardOptions);
    await writePublicApiCache(env, cacheKey, payload, generatedAt, accessLevel).catch((error) => {
      console.warn("DZN PUBLIC LEADERBOARDS CACHE WRITE FAILED", safePublicCacheError(error));
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
    logPublicApi503RootCause(endpoint, error, requestId, "leaderboards_live_query");
    const generatedAt = new Date().toISOString();
    const emptyPayload = applyLeaderboardsAccess(emptyPublicLeaderboards(leaderboardOptions), viewerLoggedIn);
    return json(withPublicApiMetadata(emptyPayload, {
      generated_at: generatedAt,
      source: "empty_no_cache",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
      message: "Leaderboard data is temporarily unavailable. Showing an empty safe fallback while live refresh recovers.",
    }), { headers: publicApiSnapshotFallbackHeaders(viewerLoggedIn) });
  }
};

function parseLeaderboardOptions(params: URLSearchParams) {
  const full = params.get("full")?.trim().toLowerCase() === "true";
  return {
    full,
    metric: params.get("metric"),
    page: numberParam(params.get("page"), 1),
    pageSize: numberParam(params.get("page_size") ?? params.get("limit"), full ? 100 : 10),
  };
}

function numberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
