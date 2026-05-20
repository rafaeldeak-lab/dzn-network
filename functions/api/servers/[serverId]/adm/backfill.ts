import { planAdmBackfillJobsForServer } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return backfillError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed || !user) {
      return backfillError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const result = await planAdmBackfillJobsForServer(env, user.id, linkedServerId, {
      triggerType: "manual",
      processImmediately: false,
    });
    return json(result, {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return backfillError(500, "adm_backfill_failed", "Unable to queue missing ADM backfill jobs.", debugDetails(request, error));
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function backfillError(status: number, errorCode: string, message: string, details: unknown = null) {
  return json({
    ok: false,
    error_code: errorCode,
    message,
    details,
  }, {
    status,
    headers: {
      "cache-control": "private, no-store, no-cache, must-revalidate",
      vary: "Cookie",
    },
  });
}

function debugDetails(request: Request, error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    stack: isDebugRequest(request) && error instanceof Error ? error.stack : undefined,
  };
}

function isDebugRequest(request: Request) {
  try {
    return new URL(request.url).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}
