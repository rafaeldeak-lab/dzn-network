import { requireBadgeAdminUser } from "../../../../_lib/badge-evaluation";
import { DznSeasonError, finaliseSeason } from "../../../../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../../../../_lib/http";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await requireBadgeAdminUser(env, request);
  if (!auth.ok) return json(auth.payload, { status: auth.status });

  try {
    const result = await finaliseSeason(env, String(params.seasonId ?? ""));
    return json({
      ok: true,
      seasonId: result.seasonId,
      entriesFinalised: result.entriesFinalised,
      awardsCreated: result.awardsCreated,
      badgesAwarded: result.badgesAwarded,
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
    console.warn("DZN season finalise unavailable", {
      requestId,
      seasonId: String(params.seasonId ?? ""),
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({
      ok: false,
      error: "SEASON_FINALISE_UNAVAILABLE",
      errorCode: "SEASON_FINALISE_UNAVAILABLE",
      message: "Season finalisation is temporarily unavailable.",
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
