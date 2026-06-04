import { DznSeasonError, getSeasonAwards, getSeasonBySlug } from "../../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, params }) => {
  try {
    const season = await getSeasonBySlug(env, String(params.slug ?? ""));
    if (!season) return json(errorPayload("SEASON_NOT_FOUND", "Season not found."), { status: 404 });
    const awards = await getSeasonAwards(env, season.id);
    return json({ ok: true, season, awards });
  } catch (error) {
    if (error instanceof DznSeasonError) return json(errorPayload(error.errorCode, error.message), { status: error.status });
    return unavailable(error);
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

function errorPayload(errorCode: string, message: string, requestId?: string) {
  return { ok: false, error: errorCode, errorCode, message, ...(requestId ? { requestId } : {}) };
}

function unavailable(error: unknown) {
  const requestId = crypto.randomUUID();
  console.warn("DZN season detail unavailable", { requestId, error: error instanceof Error ? error.message : "unknown" });
  return json(errorPayload("SEASON_UNAVAILABLE", "Season data is temporarily unavailable.", requestId), { status: 500 });
}
