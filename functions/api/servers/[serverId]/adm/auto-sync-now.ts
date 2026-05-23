import { ensureAdmSyncSchema, runAdmWorkerSyncTick } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return autoSyncError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed || !user) {
      return autoSyncError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    await ensureAdmSyncSchema(env);
    const result = await runAdmWorkerSyncTick(env, {
      linkedServerId,
      force: true,
      cursorKey: `manual_adm_auto_sync_${linkedServerId}`,
      maxLinesPerServer: 300,
    });
    const status = result.new_adm_readable_count > 0
      ? "queued"
      : result.latest_adm_unreadable_count > 0
        ? "latest_adm_unreadable"
        : result.pending_import_jobs_processed > 0
          ? "processed"
          : "no_new_adm";
    const now = new Date().toISOString();

    return json({
      ...result,
      ok: true,
      source: "owner_scoped_auto_sync",
      recoverable: result.failed === 0,
      status,
      syncStatus: status,
      latestAdmFile: result.selected_adm_file,
      lastProcessedLine: 0,
      lastSyncAt: now,
      readableRouteUsed: null,
      linesSeen: 0,
      linesRead: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      killsFound: 0,
      newKillsCreated: 0,
      duplicateKillsSkipped: 0,
      playersUpdated: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      buildEventsStored: 0,
      unknownLines: 0,
      skippedDuplicateLines: 0,
      syncDurationMs: 0,
    }, {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return autoSyncError(500, "auto_sync_now_failed", "Unable to run scoped ADM auto-sync.", {
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

function autoSyncError(status: number, errorCode: string, message: string, details: unknown = null) {
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
