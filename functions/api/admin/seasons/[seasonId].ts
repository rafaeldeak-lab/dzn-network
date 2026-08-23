import { DznSeasonError, updateAdminSeason } from "../../../_lib/dzn-seasons";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY, requirePlatformCreatorEventAdmin } from "../../../_lib/platform-creator";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestPut: PagesFunction = async ({ request, env, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;

  try {
    const seasonId = String(params?.seasonId ?? "").trim();
    if (!seasonId) {
      return json({
        ok: false,
        error: "SEASON_NOT_FOUND",
        errorCode: "SEASON_NOT_FOUND",
        message: "Season not found.",
      }, { status: 404 });
    }
    const body = await readJson<Record<string, unknown>>(request);
    const result = await updateAdminSeason(env, seasonId, body);
    return json({
      ok: true,
      role: PLATFORM_CREATOR_EVENT_ADMIN_CAPABILITY,
      season: result.season,
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
    console.warn("DZN admin season update unavailable", { requestId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "ADMIN_SEASON_UPDATE_UNAVAILABLE",
      errorCode: "ADMIN_SEASON_UPDATE_UNAVAILABLE",
      message: "DZN season update is temporarily unavailable.",
      requestId,
    }, { status: 500 });
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "PUT, OPTIONS" },
});
