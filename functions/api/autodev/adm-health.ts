import { requireCronSecret } from "../../_lib/cron-auth";
import { requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

type ServiceRow = {
  id: string;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  nitrado_service_id: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
};

type FileStateRow = {
  adm_file: string | null;
  status: string | null;
  retry_count: number | null;
  next_retry_at: string | null;
  last_http_status: number | null;
  last_error: string | null;
  last_endpoint_kind: string | null;
  last_method: string | null;
  updated_at: string | null;
};

type ImportJobRow = {
  filename: string | null;
  status: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

type DiagnosticRow = {
  file_name: string | null;
  status: string | null;
  http_status: number | null;
  error_code: string | null;
  created_at: string | null;
};

export const onRequestGet: PagesFunction = handleAdmHealth;
export const onRequestPost: PagesFunction = handleAdmHealth;
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });

async function handleAdmHealth({ request, env }: Parameters<PagesFunction>[0]) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const db = requireDb(env);
  const now = new Date().toISOString();
  const services = await db.prepare(
    `SELECT linked_servers.id,
            linked_servers.display_name,
            linked_servers.hostname,
            linked_servers.server_name,
            linked_servers.nitrado_service_name,
            linked_servers.nitrado_service_id,
            adm_sync_state.latest_adm_file,
            adm_sync_state.last_processed_file,
            adm_sync_state.last_sync_status,
            adm_sync_state.last_sync_message,
            adm_sync_state.last_sync_at,
            adm_sync_state.last_successful_sync_at
     FROM linked_servers
     LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
     WHERE linked_servers.nitrado_service_id IS NOT NULL
     ORDER BY linked_servers.created_at DESC
     LIMIT 50`,
  ).all<ServiceRow>();

  const workerHeartbeat = await db.prepare(
    `SELECT job_type, status, source, created_at
     FROM automation_cron_runs
     WHERE job_type = 'adm'
     ORDER BY created_at DESC
     LIMIT 1`,
  ).first<{ job_type: string | null; status: string | null; source: string | null; created_at: string | null }>().catch(() => null);

  const rows = await Promise.all((services.results ?? []).map(async (service) => {
    const [fileState, importJob, diagnostic, eventCount] = await Promise.all([
      db.prepare(
        `SELECT adm_file, status, retry_count, next_retry_at, last_http_status,
                last_error, last_endpoint_kind, last_method, updated_at
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
         ORDER BY COALESCE(last_diagnostic_at, last_checked_at, updated_at, first_seen_at) DESC
         LIMIT 1`,
      ).bind(service.id).first<FileStateRow>().catch(() => null),
      db.prepare(
        `SELECT filename, status, updated_at, completed_at
         FROM adm_import_jobs
         WHERE server_id = ?
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 1`,
      ).bind(service.id).first<ImportJobRow>().catch(() => null),
      db.prepare(
        `SELECT file_name, status, http_status, error_code, created_at
         FROM nitrado_file_read_attempts
         WHERE server_id = ? OR service_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      ).bind(service.id, service.nitrado_service_id ?? "").first<DiagnosticRow>().catch(() => null),
      db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ?) +
           (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ?) AS count`,
      ).bind(service.id, service.id).first<{ count: number | null }>().catch(() => ({ count: 0 })),
    ]);

    const latestClassifiedError = canonicalError(diagnostic?.error_code ?? fileState?.last_error ?? service.last_sync_message);
    return {
      serverName: service.display_name ?? service.hostname ?? service.server_name ?? service.nitrado_service_name ?? "DZN Server",
      serverId: service.id,
      serviceId: service.nitrado_service_id,
      latestAdmFile: service.latest_adm_file ?? diagnostic?.file_name ?? fileState?.adm_file ?? null,
      lastProcessedFile: service.last_processed_file,
      lastSyncStatus: service.last_sync_status,
      latestClassifiedError,
      latestHttpStatus: diagnostic?.http_status ?? fileState?.last_http_status ?? null,
      nextRetryAt: fileState?.next_retry_at ?? null,
      lastSuccessfulImportAt: service.last_successful_sync_at ?? importJob?.completed_at ?? null,
      importJobStatus: importJob?.status ?? null,
      recentEventCount: Number(eventCount?.count ?? 0),
      workerHeartbeat,
      lastSyncMessage: sanitize(service.last_sync_message),
      latestFileState: fileState ? {
        fileName: fileState.adm_file,
        status: fileState.status,
        retryCount: Number(fileState.retry_count ?? 0),
        nextRetryAt: fileState.next_retry_at,
        lastHttpStatus: fileState.last_http_status,
        lastEndpointKind: fileState.last_endpoint_kind,
        lastMethod: fileState.last_method,
        lastError: sanitize(fileState.last_error),
        updatedAt: fileState.updated_at,
      } : null,
    };
  }));

  return json({
    ok: true,
    generatedAt: now,
    worker: {
      name: "dzn-adm-sync-worker",
      heartbeat: workerHeartbeat,
    },
    services: rows,
  });
}

function canonicalError(value: string | null | undefined) {
  const text = String(value ?? "");
  if (/NITRADO_UPSTREAM_DOWN|HTTP\s+5\d\d/i.test(text)) return "NITRADO_UPSTREAM_DOWN";
  if (/NITRADO_RATE_LIMITED|HTTP\s+429/i.test(text)) return "NITRADO_RATE_LIMITED";
  if (/NITRADO_UNAUTHORIZED|HTTP\s+401/i.test(text)) return "NITRADO_UNAUTHORIZED";
  if (/NITRADO_FORBIDDEN|HTTP\s+403/i.test(text)) return "NITRADO_FORBIDDEN";
  if (/NITRADO_FILE_NOT_FOUND|HTTP\s+404/i.test(text)) return "NITRADO_FILE_NOT_FOUND";
  if (/WORKER_SUBREQUEST_LIMIT/i.test(text)) return "WORKER_SUBREQUEST_LIMIT";
  if (/FETCH_TIMEOUT/i.test(text)) return "FETCH_TIMEOUT";
  if (/FETCH_THREW/i.test(text)) return "FETCH_THREW";
  if (/TOKENIZED_EMPTY_BODY/i.test(text)) return "TOKENIZED_EMPTY_BODY";
  return text.trim() || null;
}

function sanitize(value: unknown) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(token|access_token|signature|sig|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 500);
}
