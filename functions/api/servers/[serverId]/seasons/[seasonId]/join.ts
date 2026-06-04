import { DznSeasonError, joinServerToSeason } from "../../../../../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../../../../../_lib/http";
import { resolveOwnerVisualLoadoutServer } from "../../../../../_lib/server-visual-loadouts";
import type { PagesFunction } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const entry = await joinServerToSeason(env, access.server.id, String(params.seasonId ?? ""));
    return json({
      ok: true,
      entry,
      message: "Server joined the DZN season. Scores are calculated from existing stored stats.",
    });
  } catch (error) {
    if (error instanceof DznSeasonError) return json(errorPayload(error.errorCode, error.message), { status: error.status });
    return unavailable(error, access.server.id);
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

function errorPayload(errorCode: string, message: string, requestId?: string) {
  return { ok: false, error: errorCode, errorCode, message, ...(requestId ? { requestId } : {}) };
}

function unavailable(error: unknown, serverId: string) {
  const requestId = crypto.randomUUID();
  console.warn("DZN season join unavailable", {
    requestId,
    serverId,
    error: error instanceof Error ? error.message : "unknown",
  });
  return json(errorPayload("SEASON_JOIN_UNAVAILABLE", "Season entry is temporarily unavailable.", requestId), { status: 500 });
}
