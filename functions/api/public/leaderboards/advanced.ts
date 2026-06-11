import { getPublicAdvancedLeaderboardsPayload } from "../../../_lib/advanced-leaderboards";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../_lib/public-auth";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  const url = new URL(request.url);
  const limit = numberParam(url.searchParams.get("limit"), 8);

  try {
    const payload = await getPublicAdvancedLeaderboardsPayload(env, { limit });
    return json(payload, { headers: publicAccessCacheHeaders(viewerLoggedIn) });
  } catch (error) {
    console.warn("DZN ADVANCED LEADERBOARDS LOAD FAILED", safeError(error));
    return json({
      ok: false,
      error: "advanced_leaderboards_load_failed",
      message: "Advanced leaderboard data could not be loaded right now.",
      generated_at: new Date().toISOString(),
      boards: [],
    }, { headers: publicApiErrorHeaders(), status: 503 });
  }
};

function numberParam(value: string | null, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 20)) : fallback;
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
