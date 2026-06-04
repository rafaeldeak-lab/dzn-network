import { DznSeasonError, getServerSeasonStatus } from "../../../../_lib/dzn-seasons";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { resolveOwnerVisualLoadoutServer } from "../../../../_lib/server-visual-loadouts";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const status = await getServerSeasonStatus(env, access.server.id);
    return json({ ok: true, ...status });
  } catch (error) {
    if (error instanceof DznSeasonError) return json(errorPayload(error.errorCode, error.message), { status: error.status });
    return unavailable(error, access.server.id);
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

function unavailable(error: unknown, serverId: string) {
  const requestId = crypto.randomUUID();
  console.warn("DZN owner season status unavailable", {
    requestId,
    serverId,
    error: error instanceof Error ? error.message : "unknown",
  });
  return json(errorPayload("SEASON_STATUS_UNAVAILABLE", "Season status is temporarily unavailable.", requestId), { status: 500 });
}
