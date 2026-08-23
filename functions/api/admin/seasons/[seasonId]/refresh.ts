import { DznSeasonError, refreshSeasonScores, SEASON_REFRESH_DEFAULT_LIMIT, SEASON_REFRESH_MAX_LIMIT } from "../../../../_lib/dzn-seasons";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { requirePlatformCreatorEventAdmin } from "../../../../_lib/platform-creator";
import type { PagesFunction } from "../../../../_lib/types";

type SeasonRefreshBody = {
  limit?: unknown;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;

  try {
    const body = await readJson<SeasonRefreshBody>(request);
    const limit = limitFromRequest(request, body.limit);
    const result = await refreshSeasonScores(env, String(params.seasonId ?? ""), {
      limit,
      maxLimit: SEASON_REFRESH_MAX_LIMIT,
      allowCompleted: false,
    });
    return json({
      ok: true,
      seasonId: result.seasonId,
      entriesRefreshed: result.refreshed,
      snapshotsCreated: result.snapshotsCreated,
      refreshedEntries: result.entries,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof DznSeasonError) {
      return json({
        ok: false,
        error: error.errorCode,
        errorCode: error.errorCode,
        message: error.message,
      }, { status: error.status });
    }
    const requestId = crypto.randomUUID();
    console.warn("DZN admin season refresh failed", {
      requestId,
      seasonId: String(params.seasonId ?? ""),
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({
      ok: false,
      error: "SEASON_REFRESH_UNAVAILABLE",
      errorCode: "SEASON_REFRESH_UNAVAILABLE",
      message: "Season score refresh is temporarily unavailable.",
      requestId,
    }, { status: 500 });
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

function limitFromRequest(request: Request, bodyLimit: unknown) {
  const queryLimit = new URL(request.url).searchParams.get("limit");
  const raw = queryLimit ?? bodyLimit ?? SEASON_REFRESH_DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return SEASON_REFRESH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(SEASON_REFRESH_MAX_LIMIT, Math.round(parsed)));
}
