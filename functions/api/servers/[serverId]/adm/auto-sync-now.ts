import { ensureAdmSyncSchema, runAdmWorkerSyncTick } from "../../../../_lib/adm-sync";
import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { Env, PagesFunction } from "../../../../_lib/types";

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

    const payload = await readJsonBody(request);
    const target = parseTargetFilePayload(payload);
    await ensureAdmSyncSchema(env);
    const result = await runAdmWorkerSyncTick(env, {
      linkedServerId,
      force: true,
      cursorKey: `manual_adm_auto_sync_${linkedServerId}`,
      maxLinesPerServer: 300,
      targetFileName: target.fileName,
      targetFilePath: target.filePath,
    });
    const latestReadIssue = await getLatestScopedReadIssue(env, linkedServerId, target.fileName ?? result.selected_adm_file);
    const status = classifyScopedAutoSyncStatus(result, latestReadIssue);
    const message = formatScopedAutoSyncMessage(status, target.fileName ?? result.selected_adm_file, latestReadIssue, result.message);
    const recoverable = status !== "auth_error" && status !== "auto_sync_failed";
    const now = new Date().toISOString();

    return json({
      ...result,
      ok: true,
      source: "owner_scoped_auto_sync",
      recoverable,
      status,
      syncStatus: status,
      message,
      attempted_file: target.fileName ?? result.selected_adm_file,
      attempted_path: target.filePath ?? result.selected_adm_path,
      latestAdmFile: result.selected_adm_file,
      latest_read_issue: latestReadIssue,
      latest_http_status: latestReadIssue?.last_http_status ?? null,
      latest_endpoint_kind: latestReadIssue?.last_endpoint_kind ?? null,
      latest_method: latestReadIssue?.last_method ?? null,
      next_retry_at: latestReadIssue?.next_retry_at ?? null,
      retry_count: latestReadIssue?.retry_count ?? 0,
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

type ScopedReadIssue = {
  file_name: string | null;
  status: string | null;
  retry_count: number;
  next_retry_at: string | null;
  last_http_status: number | null;
  last_endpoint_kind: string | null;
  last_method: string | null;
  last_error: string | null;
  last_diagnostic_at: string | null;
  last_checked_at: string | null;
};

async function getLatestScopedReadIssue(env: Env, linkedServerId: string, fileName: string | null): Promise<ScopedReadIssue | null> {
  const db = requireDb(env);
  const fileFilter = fileName ? "AND adm_file = ?" : "";
  const binds = fileName ? [linkedServerId, fileName] : [linkedServerId];
  const state = await db.prepare(
    `SELECT adm_file, status, retry_count, next_retry_at, last_http_status,
            last_endpoint_kind, last_method, last_error, last_diagnostic_at, last_checked_at
     FROM adm_sync_file_state
     WHERE linked_server_id = ?
       ${fileFilter}
     ORDER BY COALESCE(last_diagnostic_at, last_checked_at, updated_at, first_seen_at) DESC
     LIMIT 1`,
  ).bind(...binds).first<{
    adm_file: string | null;
    status: string | null;
    retry_count: number | null;
    next_retry_at: string | null;
    last_http_status: number | null;
    last_endpoint_kind: string | null;
    last_method: string | null;
    last_error: string | null;
    last_diagnostic_at: string | null;
    last_checked_at: string | null;
  }>().catch(() => null);
  if (state) {
    return {
      file_name: state.adm_file,
      status: state.status,
      retry_count: Number(state.retry_count ?? 0),
      next_retry_at: state.next_retry_at,
      last_http_status: state.last_http_status,
      last_endpoint_kind: state.last_endpoint_kind,
      last_method: state.last_method,
      last_error: sanitizeText(state.last_error),
      last_diagnostic_at: state.last_diagnostic_at,
      last_checked_at: state.last_checked_at,
    };
  }

  const diagnosticFileFilter = fileName ? "AND file_name = ?" : "";
  const diagnosticBinds = fileName ? [linkedServerId, linkedServerId, fileName] : [linkedServerId, linkedServerId];
  const diagnostic = await db.prepare(
    `SELECT file_name, status, http_status, endpoint_kind, method, error_code, error_message, created_at
     FROM nitrado_file_read_attempts
     WHERE (server_id = ? OR service_id = (SELECT nitrado_service_id FROM linked_servers WHERE id = ? LIMIT 1))
       ${diagnosticFileFilter}
     ORDER BY created_at DESC
     LIMIT 1`,
  ).bind(...diagnosticBinds).first<{
    file_name: string | null;
    status: string | null;
    http_status: number | null;
    endpoint_kind: string | null;
    method: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string | null;
  }>().catch(() => null);
  if (!diagnostic) return null;
  return {
    file_name: diagnostic.file_name,
    status: diagnostic.status,
    retry_count: 0,
    next_retry_at: null,
    last_http_status: diagnostic.http_status,
    last_endpoint_kind: diagnostic.endpoint_kind,
    last_method: diagnostic.method,
    last_error: sanitizeText(diagnostic.error_code ?? diagnostic.error_message),
    last_diagnostic_at: diagnostic.created_at,
    last_checked_at: diagnostic.created_at,
  };
}

function classifyScopedAutoSyncStatus(
  result: Awaited<ReturnType<typeof runAdmWorkerSyncTick>>,
  issue: ScopedReadIssue | null,
) {
  if (result.new_adm_readable_count > 0) return "queued";
  if (result.pending_import_jobs_processed > 0) return "processed";
  const httpStatus = Number(issue?.last_http_status ?? 0);
  const error = String(issue?.last_error ?? result.message ?? "").toUpperCase();
  if (httpStatus === 401 || httpStatus === 403 || error.includes("NITRADO_UNAUTHORIZED") || error.includes("NITRADO_FORBIDDEN")) return "auth_error";
  if (httpStatus === 404 || error.includes("NITRADO_FILE_NOT_FOUND")) return "file_not_found";
  if (httpStatus === 429 || error.includes("NITRADO_RATE_LIMITED")) return "nitrado_rate_limited";
  if ([500, 502, 503, 504].includes(httpStatus) || error.includes("NITRADO_UPSTREAM_DOWN")) return "nitrado_upstream_down";
  if (result.latest_adm_unreadable_count > 0 || issue) return "latest_adm_unreadable";
  return result.failed > 0 ? "auto_sync_failed" : "no_new_adm";
}

function formatScopedAutoSyncMessage(status: string, fileName: string | null, issue: ScopedReadIssue | null, fallback: string) {
  const name = fileName ?? issue?.file_name ?? "latest ADM file";
  const retry = issue?.next_retry_at ? ` Auto-sync will retry at ${issue.next_retry_at}.` : " Auto-sync will retry.";
  if (status === "queued") return `ADM auto-sync queued ${name} for import.`;
  if (status === "processed") return `ADM import work continued for ${name}.`;
  if (status === "nitrado_upstream_down") return `Nitrado file service returned HTTP ${issue?.last_http_status ?? 500} for ${name}.${retry}`;
  if (status === "nitrado_rate_limited") return `Nitrado rate-limited ADM reads for ${name}.${retry}`;
  if (status === "file_not_found") return "Nitrado listed the ADM file but the API could not read it. It may have rotated or not be available to API download yet.";
  if (status === "auth_error") return "Nitrado rejected ADM file access for this server. Re-link the Nitrado token or check service permissions.";
  if (status === "latest_adm_unreadable") return `${name} is not readable from Nitrado yet.${retry}`;
  return fallback;
}

function parseTargetFilePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return { fileName: null, filePath: null };
  const record = payload as Record<string, unknown>;
  if (record.mode !== "target_file") return { fileName: null, filePath: null };
  const fileName = sanitizeAdmFileName(record.fileName);
  const filePath = fileName ? sanitizeAdmFilePath(record.filePath, fileName) : null;
  return { fileName, filePath };
}

async function readJsonBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function sanitizeAdmFileName(value: unknown) {
  if (typeof value !== "string") return null;
  const filename = value.trim().replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
  if (!/^DayZServer_[A-Za-z0-9_-]+\.ADM$/i.test(filename)) return null;
  return filename;
}

function sanitizeAdmFilePath(value: unknown, fileName: string) {
  const expected = `dayzps/config/${fileName}`;
  if (typeof value !== "string") return expected;
  const path = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return path.toLowerCase() === expected.toLowerCase() ? path : expected;
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizeText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 500) : null;
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
