import { getPublicAdvancedLeaderboardsPayload } from "../../../_lib/advanced-leaderboards";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../_lib/public-auth";
import type { PagesFunction } from "../../../_lib/types";

const ADVANCED_CATEGORIES = [
  "overall",
  "pvp",
  "deathmatch",
  "pve",
  "hybrid",
  "builds",
  "survival",
  "travel",
  "exploration",
  "weapons",
  "premium_showcase",
];

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
      ok: true,
      generated_at: new Date().toISOString(),
      categories: ADVANCED_CATEGORIES,
      boards: [],
      notes: [
        "Advanced Showcase is temporarily unavailable. Core leaderboards remain live.",
        "Retry shortly; public advanced routes never expose raw coordinates or exact player routes.",
      ],
      stale: true,
      fallback_reason: "advanced_live_query_failed_no_snapshot",
    }, { headers: publicApiErrorHeaders() });
  }
};

function numberParam(value: string | null, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 20)) : fallback;
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
