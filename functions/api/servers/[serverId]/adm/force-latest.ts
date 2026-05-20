import { createScheduledAdmImportJobForServer } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return forceLatestError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed || !user) {
      return forceLatestError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const result = await createScheduledAdmImportJobForServer(env, user.id, linkedServerId, {
      triggerType: "manual",
      chunksToProcess: 3,
    });
    const job = result.job;

    return json({
      ...result,
      linesSeen: job?.total_lines ?? 0,
      linesProcessed: job?.current_line ?? 0,
      eventsCreated: (job?.player_events_stored ?? 0) + (job?.written_kills ?? 0),
      killsCreated: job?.written_kills ?? 0,
      killsFound: job?.parsed_kills ?? 0,
      newKillsCreated: job?.written_kills ?? 0,
      duplicateKillsSkipped: job?.duplicate_skips ?? 0,
      playersUpdated: job?.player_events_stored ?? 0,
      lastProcessedLine: job?.current_line ?? 0,
      lastSyncAt: new Date().toISOString(),
      readableRouteUsed: job ? "chunked_import_job" : null,
      linesRead: job?.total_lines ?? 0,
      syncStatus: result.status,
      rawEventsStored: job?.raw_events_stored ?? 0,
      playerEventsStored: job?.player_events_stored ?? 0,
      killEventsStored: job?.written_kills ?? 0,
      buildEventsStored: 0,
      unknownLines: 0,
      skippedDuplicateLines: job?.duplicate_skips ?? 0,
      syncDurationMs: 0,
    }, {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return forceLatestError(500, "force_latest_adm_failed", "Unable to force process the latest ADM file.", {
      error: error instanceof Error ? error.message : String(error),
      stack: isDebugRequest(request) && error instanceof Error ? error.stack : undefined,
    });
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

function forceLatestError(status: number, errorCode: string, message: string, details: unknown = null) {
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

function isDebugRequest(request: Request) {
  try {
    return new URL(request.url).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}
