import { requireCronSecret } from "../../_lib/cron-auth";
import { json } from "../../_lib/http";
import type { Env, PagesFunction } from "../../_lib/types";

type ServiceRow = {
  id: string;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  nitrado_service_id: string | null;
  current_players?: number | null;
  max_players?: number | null;
  player_count_last_checked_at?: string | null;
  metadata_last_checked_at?: string | null;
  last_worker_selected_at?: string | null;
  next_worker_due_at?: string | null;
  selected_count?: number | null;
  last_selection_reason?: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  last_sync_at: string | null;
};

type FileStateRow = {
  adm_file: string | null;
  status: string | null;
  line_count?: number | null;
  latest_known_line_count?: number | null;
  imported_line_count?: number | null;
  cursor_line?: number | null;
  last_read_at?: string | null;
  last_growth_at?: string | null;
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
  source: string | null;
  status: string | null;
  current_line: number | null;
  total_lines: number | null;
  chunks_processed: number | null;
  total_chunks: number | null;
  parsed_kills: number | null;
  written_kills: number | null;
  duplicate_skips: number | null;
  joins: number | null;
  disconnects: number | null;
  playerlist_snapshots: number | null;
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

type SourceStateRow = {
  source_name: string | null;
  last_tested_at: string | null;
  last_status: string | null;
  last_http_status: number | null;
  last_error_code: string | null;
  works: number | null;
  preferred: number | null;
  next_test_at: string | null;
};

type WorkerHeartbeatRow = {
  worker_name: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_selected_service_id: string | null;
  last_selected_server_id: string | null;
  last_action: string | null;
  last_recoverable: number | null;
  run_count: number | null;
  updated_at: string | null;
};

type FormattedWorkerHeartbeat = {
  name: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSelectedServiceId: string | null;
  lastSelectedServerId: string | null;
  lastAction: string | null;
  lastRecoverable: boolean;
  runCount: number;
  updatedAt: string | null;
  heartbeatAgeSeconds: number | null;
  heartbeatFresh: boolean;
  heartbeatState: "fresh" | "warning" | "stale" | "missing";
  heartbeat: { created_at: string | null } | null;
};

const RECOVERABLE_STATUSES = new Set([
  "no_new_adm",
  "no_new_log_available",
  "waiting_for_nitrado",
  "latest_adm_unreadable",
  "nitrado_upstream_down",
  "nitrado_rate_limited",
  "file_missing_or_rotated",
  "partial_budget_reached",
  "no_active_import_job",
  "awaiting_first_sync",
  "no_health_snapshot_yet",
  "adm_backfill_caught_up",
  "processing_in_chunks",
  "adm_import_job_queued",
]);

const ATTENTION_ERRORS = new Set(["NITRADO_UNAUTHORIZED", "NITRADO_FORBIDDEN"]);

export const onRequestGet: PagesFunction = handleAdmHealth;
export const onRequestPost: PagesFunction = handleAdmHealth;
export const onRequestPut: PagesFunction = (context) => authenticatedMethodNotAllowed(context);
export const onRequestDelete: PagesFunction = (context) => authenticatedMethodNotAllowed(context);
export const onRequestOptions: PagesFunction = ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
};

async function handleAdmHealth({ request, env }: Parameters<PagesFunction>[0]) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const generatedAt = new Date().toISOString();
  let db: D1Database;
  try {
    db = await requireAuthenticatedDb(env);
  } catch (error) {
    return json({
      ok: false,
      scope: "adm_tracking_only",
      generatedAt,
      status: "fatal_error",
      summary: emptySummary(false),
      services: [],
      warnings: [],
      fatalErrors: [sanitize(error instanceof Error ? error.message : "Database binding is missing.")],
    }, { status: 500 });
  }

  const warnings: string[] = [];
  const fatalErrors: string[] = [];
  const servicesResult = await safeAll<ServiceRow>(warnings, "linked ADM services", db.prepare(
    `SELECT linked_servers.id,
            linked_servers.display_name,
            linked_servers.hostname,
            linked_servers.server_name,
            linked_servers.nitrado_service_name,
            linked_servers.nitrado_service_id,
            linked_servers.current_players,
            linked_servers.max_players,
            linked_servers.player_count_last_checked_at,
            linked_servers.metadata_last_checked_at,
            worker_selection.last_worker_selected_at,
            worker_selection.next_worker_due_at,
            worker_selection.selected_count,
            worker_selection.last_selection_reason,
            adm_sync_state.latest_adm_file,
            adm_sync_state.last_processed_file,
            adm_sync_state.last_sync_status,
            adm_sync_state.last_sync_message,
            adm_sync_state.last_sync_at
     FROM linked_servers
     LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
     LEFT JOIN adm_worker_selection_state worker_selection ON worker_selection.linked_server_id = linked_servers.id
     WHERE linked_servers.nitrado_service_id IS NOT NULL
       AND linked_servers.nitrado_service_id <> ''
     ORDER BY linked_servers.created_at DESC
     LIMIT 50`,
  ));

  const heartbeatRow = await safeFirst<WorkerHeartbeatRow>(warnings, "ADM Worker heartbeat", db.prepare(
    `SELECT worker_name, last_started_at, last_finished_at, last_status, last_error_code,
            last_error_message, last_selected_service_id, last_selected_server_id,
            last_action, last_recoverable, run_count, updated_at
     FROM adm_worker_heartbeat
     WHERE worker_name = 'dzn-adm-sync-worker'
     ORDER BY updated_at DESC
     LIMIT 1`,
  ));
  const workerHeartbeat = formatWorkerHeartbeat(heartbeatRow);
  if (!heartbeatRow) {
    fatalErrors.push("ADM Worker heartbeat missing.");
  } else if (workerHeartbeat.heartbeatState === "stale") {
    fatalErrors.push(`ADM Worker heartbeat stale: last update was ${workerHeartbeat.heartbeatAgeSeconds ?? "unknown"} seconds ago.`);
  } else if (workerHeartbeat.heartbeatState === "warning") {
    warnings.push(`ADM Worker heartbeat is older than 10 minutes: ${workerHeartbeat.heartbeatAgeSeconds ?? "unknown"} seconds.`);
  }
  if (workerHeartbeat.lastStatus === "fatal_error") {
    fatalErrors.push(`ADM Worker reported fatal_error${workerHeartbeat.lastErrorCode ? ` (${workerHeartbeat.lastErrorCode})` : ""}.`);
  }

  const services = await Promise.all((servicesResult.results ?? []).map(async (service) => {
    const [fileState, importJob, lastSuccessfulJob, diagnostic, lastSyncRun, eventCount, sourceMatrix] = await Promise.all([
      safeFirst<FileStateRow>(warnings, `file state ${service.id}`, db.prepare(
        `SELECT adm_file, status, line_count, latest_known_line_count, imported_line_count,
                cursor_line, last_read_at, last_growth_at, retry_count, next_retry_at, last_http_status,
                last_error, last_endpoint_kind, last_method, updated_at
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
           AND ignored_at IS NULL
         ORDER BY COALESCE(file_timestamp, '') DESC, adm_file DESC, COALESCE(last_read_at, last_checked_at, updated_at, first_seen_at) DESC
         LIMIT 1`,
      ).bind(service.id)),
      safeFirst<ImportJobRow>(warnings, `latest import job ${service.id}`, db.prepare(
        `SELECT filename, source, status, current_line, total_lines, chunks_processed, total_chunks,
                parsed_kills, written_kills, duplicate_skips, joins, disconnects, playerlist_snapshots,
                updated_at, completed_at
         FROM adm_import_jobs
         WHERE server_id = ?
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 1`,
      ).bind(service.id)),
      safeFirst<ImportJobRow>(warnings, `last successful import job ${service.id}`, db.prepare(
        `SELECT filename, source, status, current_line, total_lines, chunks_processed, total_chunks,
                parsed_kills, written_kills, duplicate_skips, joins, disconnects, playerlist_snapshots,
                updated_at, completed_at
         FROM adm_import_jobs
         WHERE server_id = ?
           AND status IN ('completed', 'completed_with_warnings', 'completed_no_new_events', 'duplicate_skipped')
         ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
         LIMIT 1`,
      ).bind(service.id)),
      safeFirst<DiagnosticRow>(warnings, `latest diagnostic ${service.id}`, db.prepare(
        `SELECT file_name, status, http_status, error_code, created_at
         FROM nitrado_file_read_attempts
         WHERE server_id = ? OR service_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      ).bind(service.id, service.nitrado_service_id ?? "")),
      safeFirst<{ finished_at: string | null; status: string | null }>(warnings, `last sync run ${service.id}`, db.prepare(
        `SELECT finished_at, status
         FROM sync_runs
         WHERE linked_server_id = ?
           AND lower(COALESCE(status, '')) IN ('completed', 'completed_with_warnings', 'completed_no_new_events', 'duplicate_skipped', 'idle', 'no_new_lines', 'no_supported_events')
         ORDER BY COALESCE(finished_at, started_at, created_at) DESC
         LIMIT 1`,
      ).bind(service.id)),
      safeFirst<{ count: number | null }>(warnings, `recent ADM events ${service.id}`, db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM kill_events WHERE linked_server_id = ?) +
           (SELECT COUNT(*) FROM player_events WHERE linked_server_id = ?) AS count`,
      ).bind(service.id, service.id)),
      safeAll<SourceStateRow>(warnings, `live source matrix ${service.id}`, db.prepare(
        `SELECT source_name, last_tested_at, last_status, last_http_status,
                last_error_code, works, preferred, next_test_at
         FROM adm_live_source_state
         WHERE service_id = ?
         ORDER BY preferred DESC, works DESC, COALESCE(last_tested_at, updated_at) DESC
         LIMIT 12`,
      ).bind(service.nitrado_service_id ?? "")),
    ]);

    const latestClassifiedError = canonicalError(diagnostic?.error_code ?? fileState?.last_error ?? service.last_sync_message);
    const latestStatus = normalizeStatus(service.last_sync_status ?? latestClassifiedError ?? fileState?.status ?? importJob?.status ?? "awaiting_first_sync");
    const manualActionRequired = ATTENTION_ERRORS.has(latestClassifiedError ?? "") || /unauthorized|forbidden|auth_error/i.test(latestStatus);
    const recoverable = !manualActionRequired && (
      RECOVERABLE_STATUSES.has(latestStatus)
      || isRecoverableError(latestClassifiedError)
      || Boolean(fileState?.next_retry_at)
      || Boolean(lastSuccessfulJob?.completed_at || lastSyncRun?.finished_at)
    );
    const importJobLineComplete = isImportJobLineComplete(importJob);
    const activeImportJob = importJob && isActiveImportStatus(importJob.status) && !importJobLineComplete ? summarizeJob(importJob) : null;

    return {
      serviceId: service.nitrado_service_id,
      serverId: service.id,
      serverName: service.display_name ?? service.hostname ?? service.server_name ?? service.nitrado_service_name ?? "DZN Server",
      currentPlayers: Number(service.current_players ?? 0),
      maxPlayers: Number(service.max_players ?? 0),
      playerCountLastCheckedAt: service.player_count_last_checked_at ?? null,
      metadataLastCheckedAt: service.metadata_last_checked_at ?? null,
      lastWorkerSelectedAt: service.last_worker_selected_at ?? null,
      nextWorkerDueAt: service.next_worker_due_at ?? null,
      workerSelectedCount: Number(service.selected_count ?? 0),
      lastSelectionReason: service.last_selection_reason ?? null,
      latestAdmFile: fileState?.adm_file ?? service.latest_adm_file ?? diagnostic?.file_name ?? null,
      lastProcessedFile: service.last_processed_file,
      lastSyncStatus: service.last_sync_status ?? latestStatus,
      latestClassifiedError,
      latestHttpStatus: diagnostic?.http_status ?? fileState?.last_http_status ?? null,
      latestEndpointKind: fileState?.last_endpoint_kind ?? null,
      latestMethod: fileState?.last_method ?? null,
      nextRetryAt: fileState?.next_retry_at ?? null,
      activeImportJob,
      lastSuccessfulImportAt: lastSuccessfulJob?.completed_at ?? lastSyncRun?.finished_at ?? null,
      importJobStatus: importJobLineComplete ? "completed_with_warnings" : importJob?.status ?? "no_active_import_job",
      recentEventCount: Number(eventCount?.count ?? 0),
      recoverable,
      manualActionRequired,
      workerHeartbeat,
      sourceMatrix: (sourceMatrix.results ?? []).map((source) => ({
        sourceName: source.source_name,
        lastTestedAt: source.last_tested_at,
        lastStatus: source.last_status,
        lastHttpStatus: source.last_http_status,
        lastErrorCode: source.last_error_code,
        works: Number(source.works ?? 0) === 1,
        preferred: Number(source.preferred ?? 0) === 1,
        nextTestAt: source.next_test_at,
      })),
      lastSyncMessage: sanitize(service.last_sync_message),
      latestFileState: fileState ? {
        fileName: fileState.adm_file,
        status: fileState.status,
        lineCount: Number(fileState.line_count ?? 0),
        latestKnownLineCount: Number(fileState.latest_known_line_count ?? 0),
        importedLineCount: Number(fileState.imported_line_count ?? 0),
        cursorLine: Number(fileState.cursor_line ?? 0),
        lastReadAt: fileState.last_read_at,
        lastGrowthAt: fileState.last_growth_at,
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

  if (services.length === 0) warnings.push("No linked ADM services found");
  const activeImportJobs = services.filter((service) => service.activeImportJob).length;
  const recoverableIssues = services.filter((service) => service.recoverable && (service.latestClassifiedError || isRecoverableStatus(service.lastSyncStatus))).length;
  const fatalIssues = services.filter((service) => service.manualActionRequired).length + fatalErrors.length;
  const status = fatalIssues > 0
    ? workerHeartbeat.heartbeatState === "missing"
      ? "worker_heartbeat_missing"
      : workerHeartbeat.heartbeatState === "stale"
        ? "worker_heartbeat_stale"
        : "needs_attention"
    : services.length === 0
      ? "awaiting_first_sync"
      : recoverableIssues > 0
        ? "recoverable"
        : activeImportJobs > 0
          ? "importing"
          : "healthy";

  return json({
    ok: true,
    scope: "adm_tracking_only",
    generatedAt,
    status,
    summary: {
      servicesChecked: services.length,
      workerHeartbeatFresh: workerHeartbeat.heartbeatFresh,
      activeImportJobs,
      recoverableIssues,
      fatalIssues,
    },
    worker: workerHeartbeat,
    services,
    warnings: warnings.map(sanitize),
    fatalErrors,
  });
}

async function requireAuthenticatedDb(env: Env) {
  const { requireDb } = await import("../../_lib/db");
  return requireDb(env);
}

function authenticatedMethodNotAllowed({ request, env }: Parameters<PagesFunction>[0]) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  return json({ error: "Method not allowed" }, { status: 405 });
}

async function safeAll<T>(warnings: string[], label: string, statement: D1PreparedStatement) {
  try {
    return await statement.all<T>();
  } catch (error) {
    warnings.push(`${label}: ${sanitize(error instanceof Error ? error.message : String(error))}`);
    return { results: [] as T[], success: false, meta: undefined };
  }
}

async function safeFirst<T>(warnings: string[], label: string, statement: D1PreparedStatement) {
  try {
    return await statement.first<T>();
  } catch (error) {
    warnings.push(`${label}: ${sanitize(error instanceof Error ? error.message : String(error))}`);
    return null;
  }
}

function summarizeJob(job: ImportJobRow) {
  return {
    filename: job.filename,
    source: job.source,
    status: job.status,
    currentLine: Number(job.current_line ?? 0),
    totalLines: Number(job.total_lines ?? 0),
    chunksProcessed: Number(job.chunks_processed ?? 0),
    totalChunks: Number(job.total_chunks ?? 0),
    parsedKills: Number(job.parsed_kills ?? 0),
    writtenKills: Number(job.written_kills ?? 0),
    duplicateSkips: Number(job.duplicate_skips ?? 0),
    joins: Number(job.joins ?? 0),
    disconnects: Number(job.disconnects ?? 0),
    playerlistSnapshots: Number(job.playerlist_snapshots ?? 0),
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  };
}

function isActiveImportStatus(status: string | null | undefined) {
  return /queued|processing|parsing|writing|rebuilding|failed_retryable/i.test(String(status ?? ""));
}

function isImportJobLineComplete(job: ImportJobRow | null) {
  if (!job) return false;
  const total = Number(job.total_lines ?? 0);
  return total > 0 && Number(job.current_line ?? 0) >= total && /rebuilding|failed_retryable/i.test(String(job.status ?? ""));
}

function isRecoverableStatus(value: string | null | undefined) {
  return RECOVERABLE_STATUSES.has(normalizeStatus(value));
}

function isRecoverableError(value: string | null | undefined) {
  const text = String(value ?? "").toUpperCase();
  return [
    "NITRADO_UPSTREAM_DOWN",
    "NITRADO_RATE_LIMITED",
    "NITRADO_FILE_NOT_FOUND",
    "WORKER_SUBREQUEST_LIMIT",
    "FETCH_TIMEOUT",
    "FETCH_THREW",
    "TOKENIZED_EMPTY_BODY",
  ].includes(text);
}

function formatWorkerHeartbeat(row: WorkerHeartbeatRow | null): FormattedWorkerHeartbeat {
  const updatedAt = row?.updated_at ?? null;
  const heartbeatAgeSeconds = heartbeatAgeSecondsFor(updatedAt);
  const heartbeatState = !row
    ? "missing"
    : heartbeatAgeSeconds === null
      ? "missing"
      : heartbeatAgeSeconds <= 10 * 60
        ? "fresh"
        : heartbeatAgeSeconds <= 15 * 60
          ? "warning"
          : "stale";
  return {
    name: row?.worker_name ?? "dzn-adm-sync-worker",
    lastStartedAt: row?.last_started_at ?? null,
    lastFinishedAt: row?.last_finished_at ?? null,
    lastStatus: row?.last_status ?? null,
    lastErrorCode: sanitize(row?.last_error_code),
    lastErrorMessage: sanitize(row?.last_error_message),
    lastSelectedServiceId: row?.last_selected_service_id ?? null,
    lastSelectedServerId: row?.last_selected_server_id ?? null,
    lastAction: row?.last_action ?? null,
    lastRecoverable: Number(row?.last_recoverable ?? 0) === 1,
    runCount: Number(row?.run_count ?? 0),
    updatedAt,
    heartbeatAgeSeconds,
    heartbeatFresh: heartbeatState === "fresh",
    heartbeatState,
    heartbeat: updatedAt ? { created_at: updatedAt } : null,
  };
}

function heartbeatAgeSecondsFor(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

function emptySummary(workerHeartbeatFresh: boolean) {
  return {
    servicesChecked: 0,
    workerHeartbeatFresh,
    activeImportJobs: 0,
    recoverableIssues: 0,
    fatalIssues: 1,
  };
}

function normalizeStatus(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() || "awaiting_first_sync";
}

function canonicalError(value: string | null | undefined) {
  const text = String(value ?? "");
  if (!text.trim() || /ADM chunk import completed|Scheduled ADM import completed|Manual ADM import completed|completed in \d+ chunks?|ADM backfill is caught up|is caught up at \d+ lines|already imported|processed successfully/i.test(text)) return null;
  if (/NITRADO_UPSTREAM_DOWN|HTTP\s+5\d\d/i.test(text)) return "NITRADO_UPSTREAM_DOWN";
  if (/NITRADO_RATE_LIMITED|HTTP\s+429/i.test(text)) return "NITRADO_RATE_LIMITED";
  if (/NITRADO_UNAUTHORIZED|HTTP\s+401/i.test(text)) return "NITRADO_UNAUTHORIZED";
  if (/NITRADO_FORBIDDEN|HTTP\s+403/i.test(text)) return "NITRADO_FORBIDDEN";
  if (/NITRADO_FILE_NOT_FOUND|FILE_MISSING_OR_ROTATED|HTTP\s+404/i.test(text)) return "NITRADO_FILE_NOT_FOUND";
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
