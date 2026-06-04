import { requireBadgeAdminUser } from "../../_lib/badge-evaluation";
import { DznSeasonError, getAdminSeasonManagement } from "../../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await requireBadgeAdminUser(env, request);
  if (!auth.ok) return json(auth.payload, { status: auth.status });

  try {
    const limit = limitFromRequest(request);
    const result = await getAdminSeasonManagement(env, limit);
    return json({
      ok: true,
      role: auth.role,
      seasons: result.seasons,
      activeSeasons: result.activeSeasons,
      upcomingSeasons: result.upcomingSeasons,
      completedSeasons: result.completedSeasons,
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
    console.warn("DZN admin seasons unavailable", { requestId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "ADMIN_SEASONS_UNAVAILABLE",
      errorCode: "ADMIN_SEASONS_UNAVAILABLE",
      message: "DZN season admin data is temporarily unavailable.",
      requestId,
    }, { status: 500 });
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});

function limitFromRequest(request: Request) {
  const parsed = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(250, Math.round(parsed)));
}
