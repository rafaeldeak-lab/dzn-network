import { ensureAdmSyncSchema } from "../../../../_lib/adm-sync";
import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { effectiveEntitlementPlan, getAdmDiscoveryIntervalMinutes, getAdmPullInterval, getServerStatusInterval, normalizePlanKey } from "../../../../_lib/plans";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import { calculateServerScore } from "../../../../_lib/server-ranking";
import type { PagesFunction } from "../../../../_lib/types";

type ServerRow = {
  id: string;
  guild_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  linked_status: string | null;
  current_players: number | null;
  max_players: number | null;
  player_slots: number | null;
  player_count_last_checked_at: string | null;
  player_count_status: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  newest_available_adm_filename: string | null;
  newest_readable_adm_filename: string | null;
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
  last_adm_discovery_error: string | null;
  adm_discovery_status: string | null;
  last_status_check_at: string | null;
  next_status_check_due_at: string | null;
  latest_adm_file: string | null;
  last_processed_adm_filename: string | null;
  last_sync_status: string | null;
  last_sync_at: string | null;
  last_successful_sync_at?: string | null;
  last_sync_message: string | null;
  consecutive_failed_adm_reads: number | null;
};

type StatsRow = {
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  longest_kill: number | null;
};

type JobRow = {
  id: string;
  filename: string;
  source: string;
  status: string;
  total_lines: number | null;
  current_line: number | null;
  chunk_size: number | null;
  total_chunks: number | null;
  chunks_processed: number | null;
  parsed_kills: number | null;
  written_kills: number | null;
  duplicate_skips: number | null;
  joins: number | null;
  disconnects: number | null;
  playerlist_snapshots: number | null;
  updated_at: string | null;
  completed_at: string | null;
  error_message: string | null;
};

type RecentEventRow = {
  source: "kill" | "player";
  event_type: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
  event_label: string | null;
  detail: string | null;
  cause: string | null;
  object_type: string | null;
  is_mock: number | null;
};

type CronRow = {
  job_type: string | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
};

type AdmFileReadIssueRow = {
  adm_file: string | null;
  file_path?: string | null;
  status: string | null;
  line_count?: number | null;
  latest_known_line_count?: number | null;
  imported_line_count?: number | null;
  cursor_line?: number | null;
  last_read_at?: string | null;
  last_growth_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  retry_count: number | null;
  next_retry_at: string | null;
  last_http_status: number | null;
  last_endpoint_kind: string | null;
  last_method: string | null;
  last_error: string | null;
  last_diagnostic_at: string | null;
  last_checked_at: string | null;
};

type NitradoFileReadDiagnosticRow = {
  file_name: string | null;
  file_path: string | null;
  method: string | null;
  endpoint_kind: string | null;
  status: string | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | null;
};

type CompletedImportRow = {
  id: string | null;
  filename: string | null;
  source: string | null;
  status: string | null;
  completed_at: string | null;
  updated_at: string | null;
};

type SourceStateRow = {
  source_name: string | null;
  last_status: string | null;
  last_http_status: number | null;
  works: number | null;
  preferred: number | null;
  next_test_at: string | null;
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeId(params.serverId);
    if (!linkedServerId) return dashboardHealthError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed) {
      return dashboardHealthError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    await ensureAdmSyncSchema(env);
    const db = requireDb(env);
    const now = new Date().toISOString();
    const [server, stats, recentEvents, activeJob, queuedJobs, completedToday, fileState, currentFileState, latestReadIssue, cronRows] = await Promise.all([
      db.prepare(
        `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
                linked_servers.nitrado_service_id, linked_servers.display_name,
                linked_servers.hostname, linked_servers.server_name, linked_servers.nitrado_service_name,
                linked_servers.status AS linked_status,
                linked_servers.current_players, linked_servers.max_players, linked_servers.player_slots,
                linked_servers.player_count_last_checked_at, linked_servers.player_count_status,
                server_subscriptions.plan_key, server_subscriptions.status AS subscription_status,
                server_sync_state.newest_available_adm_filename,
                server_sync_state.newest_readable_adm_filename,
                server_sync_state.last_adm_discovery_check_at,
                server_sync_state.next_adm_discovery_due_at,
                server_sync_state.next_adm_pull_due_at,
                server_sync_state.last_adm_discovery_error,
                server_sync_state.adm_discovery_status,
                server_sync_state.last_status_check_at,
                server_sync_state.next_status_check_due_at,
                adm_sync_state.latest_adm_file,
                adm_sync_state.last_processed_file AS last_processed_adm_filename,
                adm_sync_state.last_sync_status,
                adm_sync_state.last_sync_at,
                adm_sync_state.last_sync_message,
                adm_sync_state.consecutive_failed_adm_reads
         FROM linked_servers
         LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
         LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
         LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
         WHERE linked_servers.id = ?
         LIMIT 1`,
      ).bind(linkedServerId).first<ServerRow>(),
      db.prepare(
        `SELECT total_kills, total_deaths, total_joins, total_disconnects, unique_players,
                COALESCE((SELECT MAX(COALESCE(distance, 0)) FROM kill_events WHERE linked_server_id = ?), 0) AS longest_kill
         FROM server_stats
         WHERE linked_server_id = ?
         LIMIT 1`,
      ).bind(linkedServerId, linkedServerId).first<StatsRow>().catch(() => null),
      db.prepare(
        `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance,
                occurred_at, created_at, event_label, detail, cause, object_type, is_mock
         FROM (
           SELECT 'kill' AS source,
                  'pvp_kill' AS event_type,
                  NULL AS player_name,
                  killer_name,
                  victim_name,
                  weapon,
                  distance,
                  occurred_at,
                  created_at,
                  'PvP Kill' AS event_label,
                  raw_line AS detail,
                  NULL AS cause,
                  NULL AS object_type,
                  0 AS is_mock,
                  COALESCE(occurred_at, created_at) AS sort_time
           FROM kill_events
           WHERE linked_server_id = ?
           UNION ALL
           SELECT 'player' AS source,
                  event_type,
                  player_name,
                  NULL AS killer_name,
                  NULL AS victim_name,
                  NULL AS weapon,
                  NULL AS distance,
                  occurred_at,
                  created_at,
                  event_type AS event_label,
                  raw_line AS detail,
                  cause,
                  object_type,
                  0 AS is_mock,
                  COALESCE(occurred_at, created_at) AS sort_time
           FROM player_events
           WHERE linked_server_id = ?
             AND event_type NOT LIKE 'player_hit%'
         )
         ORDER BY sort_time DESC
         LIMIT 10`,
      ).bind(linkedServerId, linkedServerId).all<RecentEventRow>().catch(() => ({ results: [] as RecentEventRow[] })),
      db.prepare(
        `SELECT id, filename, source, status, total_lines, current_line, chunk_size,
                total_chunks, chunks_processed, parsed_kills, written_kills, duplicate_skips,
                joins, disconnects, playerlist_snapshots, updated_at, completed_at, error_message
         FROM adm_import_jobs
         WHERE server_id = ?
           AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable')
           AND NOT (COALESCE(total_lines, 0) > 0 AND COALESCE(current_line, 0) >= COALESCE(total_lines, 0) AND status IN ('rebuilding', 'failed_retryable'))
         ORDER BY created_at ASC
         LIMIT 1`,
      ).bind(linkedServerId).first<JobRow>().catch(() => null),
      db.prepare(
        "SELECT COUNT(*) AS count FROM adm_import_jobs WHERE server_id = ? AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable') AND NOT (COALESCE(total_lines, 0) > 0 AND COALESCE(current_line, 0) >= COALESCE(total_lines, 0) AND status IN ('rebuilding', 'failed_retryable'))",
      ).bind(linkedServerId).first<{ count: number | null }>().catch(() => ({ count: 0 })),
      db.prepare(
        "SELECT COUNT(*) AS count FROM adm_import_jobs WHERE server_id = ? AND status IN ('completed', 'completed_with_warnings') AND date(COALESCE(completed_at, updated_at, created_at)) = date('now')",
      ).bind(linkedServerId).first<{ count: number | null }>().catch(() => ({ count: 0 })),
      db.prepare(
        `SELECT
           SUM(CASE WHEN status IN ('discovered', 'unreadable', 'parser_error', 'write_error', 'partial') THEN 1 ELSE 0 END) AS missing_count,
           MIN(CASE WHEN status IN ('discovered', 'unreadable', 'parser_error', 'write_error', 'partial') THEN adm_file ELSE NULL END) AS oldest_missing_file,
           MAX(CASE WHEN status IN ('discovered', 'unreadable', 'parser_error', 'write_error', 'partial') THEN adm_file ELSE NULL END) AS newest_missing_file,
           SUM(CASE WHEN status = 'unreadable' THEN 1 ELSE 0 END) AS unreadable_count
         FROM adm_sync_file_state
         WHERE linked_server_id = ?`,
      ).bind(linkedServerId).first<{ missing_count: number | null; oldest_missing_file: string | null; newest_missing_file: string | null; unreadable_count: number | null }>().catch(() => null),
      db.prepare(
        `SELECT adm_file, adm_path AS file_path, status, line_count, latest_known_line_count,
                imported_line_count, cursor_line, completed_at, retry_count, next_retry_at,
                last_http_status, last_endpoint_kind, last_method, last_error,
                last_diagnostic_at, last_checked_at, updated_at
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
           AND ignored_at IS NULL
         ORDER BY COALESCE(file_timestamp, '') DESC, adm_file DESC, COALESCE(updated_at, first_seen_at) DESC
         LIMIT 1`,
      ).bind(linkedServerId).first<AdmFileReadIssueRow>().catch(() => null),
      db.prepare(
        `SELECT adm_file, adm_path AS file_path, status, retry_count, next_retry_at, last_http_status,
                last_endpoint_kind, last_method, last_error, last_diagnostic_at, last_checked_at
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
           AND status IN ('unreadable', 'failed_unreadable')
         ORDER BY COALESCE(last_checked_at, updated_at, first_seen_at) DESC
         LIMIT 1`,
      ).bind(linkedServerId).first<AdmFileReadIssueRow>().catch(() => null),
      db.prepare(
        `SELECT job_type, status, source, created_at
         FROM automation_cron_runs
         WHERE source = 'cloudflare'
         ORDER BY created_at DESC
         LIMIT 30`,
      ).all<CronRow>().catch(() => ({ results: [] as CronRow[] })),
    ]);

    if (!server) return dashboardHealthError(404, "server_not_found", "Server not found.");
    const [latestDiagnostic, latestCompletedImport, preferredSourceState] = await Promise.all([
      db.prepare(
        `SELECT file_name, file_path, method, endpoint_kind, status, http_status, error_code, error_message, created_at
         FROM nitrado_file_read_attempts
         WHERE (server_id = ? OR service_id = ?)
         ORDER BY created_at DESC
         LIMIT 1`,
      ).bind(linkedServerId, server.nitrado_service_id ?? "").first<NitradoFileReadDiagnosticRow>().catch(() => null),
      db.prepare(
        `SELECT id, filename, source, status, completed_at, updated_at
         FROM adm_import_jobs
         WHERE server_id = ?
           AND status IN ('completed', 'completed_with_warnings')
         ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
         LIMIT 1`,
      ).bind(linkedServerId).first<CompletedImportRow>().catch(() => null),
      db.prepare(
        `SELECT source_name, last_status, last_http_status, works, preferred, next_test_at
         FROM adm_live_source_state
         WHERE service_id = ?
         ORDER BY preferred DESC, works DESC, COALESCE(last_tested_at, updated_at) DESC
         LIMIT 1`,
      ).bind(server.nitrado_service_id ?? "").first<SourceStateRow>().catch(() => null),
    ]);
    const latestReadTruth = normalizeLatestReadTruth(latestReadIssue, latestDiagnostic);

    const planKey = normalizePlanKey(server.plan_key);
    const currentPlan = effectiveEntitlementPlan(planKey, server.subscription_status);
    const statsSnapshot = statsFromRow(stats, server);
    const score = calculateServerScore({
      kills: statsSnapshot.kills,
      deaths: statsSnapshot.deaths,
      uniquePlayers: statsSnapshot.unique_players,
      joins: statsSnapshot.joins,
      longestKill: numberOrZero(stats?.longest_kill),
      statsSyncActive: Boolean(server.last_processed_adm_filename || activeJob || statsSnapshot.kills || statsSnapshot.joins),
    });
    const events = (recentEvents.results ?? []).map(normalizeRecentEvent);
    const cron = cronSnapshot(cronRows.results ?? [], now);
    const activeJobSnapshot = activeJob ? normalizeJob(activeJob) : null;
    const currentLiveAdm = buildCurrentLiveAdmStatus(currentFileState, activeJobSnapshot, latestCompletedImport, server, statsSnapshot, preferredSourceState);
    const backlogIssueAppliesToCurrent = latestReadTruth && currentLiveAdm.currentFile
      ? normalizeAdmFilename(latestReadTruth.adm_file) === normalizeAdmFilename(currentLiveAdm.currentFile)
      : !currentLiveAdm.currentFile;
    const admStatus = activeJobSnapshot
      ? "Importing ADM"
      : currentLiveAdm.healthy
        ? "ADM Sync Active"
        : server.newest_available_adm_filename && !server.newest_readable_adm_filename
        ? "Waiting for Nitrado"
        : statsSnapshot.kills > 0 || statsSnapshot.joins > 0 || server.last_processed_adm_filename
          ? "ADM Sync Active"
          : "Waiting for Nitrado";
    const admNitradoReadFailure = numberOrZero(server.consecutive_failed_adm_reads) >= 3;
    const admReadStatusMessage = formatAdmReadIssueMessage(latestReadTruth, server.last_sync_message);
    const latestClassifiedError = classifyAdmReadIssue(latestReadTruth, server.last_sync_message);
    const canonicalError = currentLiveAdm.healthy && !backlogIssueAppliesToCurrent ? null : canonicalAdmErrorCode(latestClassifiedError);
    const latestHttpStatus = numberOrNull(latestReadTruth?.last_http_status);
    const admNitradoReadFailureMessage = admReadStatusMessage
      ?? "DZN found the latest ADM but Nitrado has not made it readable yet. Auto-sync will retry automatically.";
    const warnings = [
      ...(!cron.adm_recent ? ["adm_cron_stale"] : []),
      ...(fileState && numberOrZero(fileState.missing_count) > 0 && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent) ? ["adm_backfill_missing"] : []),
      ...(fileState && numberOrZero(fileState.unreadable_count) > 0 && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent) ? ["nitrado_read_waiting"] : []),
      ...(admNitradoReadFailure && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent) ? ["adm_nitrado_read_failure"] : []),
      ...(server.subscription_status && !["active", "trialing"].includes(String(server.subscription_status).toLowerCase()) ? ["subscription_not_active"] : []),
    ];

    const payload = {
      ok: true,
      data: null,
      generated_at: now,
      stale: false,
      source: "live",
      server_id: server.id,
      server_name: server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name ?? "DZN Server",
      server: {
        id: server.id,
        guild_id: server.guild_id,
        public_slug: server.public_slug,
        service_id: server.nitrado_service_id,
        status: server.linked_status,
        current_players: numberOrNull(server.current_players),
        max_players: numberOrNull(server.max_players ?? server.player_slots),
        player_count_last_checked_at: server.player_count_last_checked_at,
        player_count_status: server.player_count_status,
      },
      current_plan: currentPlan,
      configured_plan: planKey,
      subscription_status: server.subscription_status,
      plan_limits: {
        status_interval_minutes: getServerStatusInterval(currentPlan),
        adm_discovery_interval_minutes: getAdmDiscoveryIntervalMinutes(currentPlan),
        adm_processing_interval_minutes: getAdmPullInterval(currentPlan),
      },
      stats: {
        players: numberOrZero(server.current_players),
        kills: statsSnapshot.kills,
        deaths: statsSnapshot.deaths,
        joins: statsSnapshot.joins,
        disconnects: statsSnapshot.disconnects,
        unique_players: statsSnapshot.unique_players,
        score,
      },
      autoSync: {
        overallStatus: ownerAutoSyncStatus(activeJobSnapshot, canonicalError, server, statsSnapshot),
        headline: ownerAutoSyncHeadline(activeJobSnapshot, canonicalError, server, statsSnapshot),
        message: ownerAutoSyncMessage(activeJobSnapshot, canonicalError, latestHttpStatus, currentLiveAdm.healthy && !backlogIssueAppliesToCurrent ? null : admReadStatusMessage),
        admSource: ownerAdmSource(latestReadTruth, activeJobSnapshot, preferredSourceState),
        latestAdmState: currentLiveAdm.status ?? ownerLatestAdmState(activeJobSnapshot, canonicalError, server, latestCompletedImport),
        latestAdmFile: currentLiveAdm.currentFile ?? server.newest_available_adm_filename ?? server.latest_adm_file ?? latestReadTruth?.adm_file ?? null,
        lastSuccessfulImportAt: latestCompletedImport?.completed_at ?? latestCompletedImport?.updated_at ?? server.last_successful_sync_at ?? null,
        lastAttemptedReadAt: latestReadTruth?.last_diagnostic_at ?? latestReadTruth?.last_checked_at ?? server.last_sync_at ?? null,
        nextDiscoveryAt: server.next_adm_discovery_due_at,
        nextProcessingAt: server.next_adm_pull_due_at,
        latestClassifiedError: canonicalError,
        upstreamHttpStatus: canonicalError ? latestHttpStatus : null,
        retryMode: "automatic",
        backoffEnabled: true,
        queueStatus: activeJobSnapshot ? "importing" : numberOrZero(queuedJobs?.count) > 0 ? "import_queued" : canonicalError ? "retrying" : "waiting",
        manualActionRequired: canonicalError === "NITRADO_UNAUTHORIZED" || canonicalError === "NITRADO_FORBIDDEN",
        currentLiveAdm,
      },
      recent_events_count: events.length,
      latest_event_at: latestEventAt(events),
      latest_events: events,
      sync: {
        status: server.last_sync_status ?? admStatus,
        adm_status: admStatus,
        active_job: activeJobSnapshot,
        backfill_status: {
          missing_files_count: numberOrZero(fileState?.missing_count),
          queued_jobs_count: numberOrZero(queuedJobs?.count),
          active_file: activeJobSnapshot?.filename ?? null,
          completed_today: numberOrZero(completedToday?.count),
          oldest_missing_file: fileState?.oldest_missing_file ?? null,
          newest_missing_file: fileState?.newest_missing_file ?? null,
          unreadable_files_count: numberOrZero(fileState?.unreadable_count),
          next_action: activeJobSnapshot
            ? `Continue importing ${activeJobSnapshot.filename}`
            : numberOrZero(fileState?.missing_count) > 0
              ? `Backfill ${numberOrZero(fileState?.missing_count)} missing ADM file${numberOrZero(fileState?.missing_count) === 1 ? "" : "s"}`
              : "ADM backfill caught up",
        },
        latest_read_issue: latestReadTruth ? {
          file_name: latestReadTruth.adm_file,
          status: latestReadTruth.status,
          retry_count: numberOrZero(latestReadTruth.retry_count),
          next_retry_at: latestReadTruth.next_retry_at,
          last_http_status: numberOrNull(latestReadTruth.last_http_status),
          last_endpoint_kind: latestReadTruth.last_endpoint_kind,
          last_method: latestReadTruth.last_method,
          last_error: sanitize(latestReadTruth.last_error),
          last_diagnostic_at: latestReadTruth.last_diagnostic_at,
          last_checked_at: latestReadTruth.last_checked_at,
        } : null,
        last_attempted_adm_read: latestReadTruth?.last_diagnostic_at ?? latestReadTruth?.last_checked_at ?? server.last_sync_at ?? null,
        latest_unreadable_file: latestReadTruth?.adm_file ?? null,
        latest_classified_error: canonicalError,
        latest_http_status: canonicalError ? latestHttpStatus : null,
        latest_endpoint_kind: latestReadTruth?.last_endpoint_kind ?? null,
        latest_method: latestReadTruth?.last_method ?? null,
        adm_source: ownerAdmSource(latestReadTruth, activeJobSnapshot, preferredSourceState),
        current_live_adm_status: currentLiveAdm,
        backlog_status: {
          old_unreadable_count: numberOrZero(fileState?.unreadable_count),
          missing_files_count: numberOrZero(fileState?.missing_count),
          oldest_unreadable: fileState?.oldest_missing_file ?? null,
          newest_unreadable: fileState?.newest_missing_file ?? null,
          latest_recoverable_error: currentLiveAdm.healthy && !backlogIssueAppliesToCurrent ? latestClassifiedError : null,
          latest_http_status: currentLiveAdm.healthy && !backlogIssueAppliesToCurrent ? latestHttpStatus : null,
        },
        latest_completed_import: latestCompletedImport ? {
          id: latestCompletedImport.id,
          filename: latestCompletedImport.filename,
          source: latestCompletedImport.source,
          status: latestCompletedImport.status,
          completed_at: latestCompletedImport.completed_at,
          updated_at: latestCompletedImport.updated_at,
        } : null,
        newest_available_adm_filename: server.newest_available_adm_filename,
        newest_readable_adm_filename: server.newest_readable_adm_filename,
        last_processed_adm_filename: server.last_processed_adm_filename ?? server.latest_adm_file,
        last_successful_sync: server.last_successful_sync_at ?? latestCompletedImport?.completed_at ?? latestCompletedImport?.updated_at ?? null,
        next_adm_discovery_due_at: server.next_adm_discovery_due_at,
        next_adm_processing_due_at: server.next_adm_pull_due_at,
        last_error: sanitize(admReadStatusMessage ?? server.last_adm_discovery_error ?? server.last_sync_message),
        consecutive_failed_adm_reads: numberOrZero(server.consecutive_failed_adm_reads),
        adm_nitrado_read_failure: admNitradoReadFailure && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent),
        adm_nitrado_read_failure_message: admNitradoReadFailure && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent) ? admNitradoReadFailureMessage : null,
        next_action: activeJobSnapshot
          ? `Importing ${activeJobSnapshot.filename}`
          : server.newest_available_adm_filename && !server.newest_readable_adm_filename
            ? "Waiting for Nitrado to return readable ADM text"
            : "ADM sync active",
      },
      cron,
      setup_progress: setupProgress({
        hasGuild: Boolean(server.guild_id),
        hasService: Boolean(server.nitrado_service_id),
        hasAdm: Boolean(server.newest_available_adm_filename || server.latest_adm_file || server.last_processed_adm_filename),
        hasStats: statsSnapshot.kills > 0 || statsSnapshot.joins > 0 || statsSnapshot.unique_players > 0,
      }),
      adm_nitrado_read_failure: admNitradoReadFailure && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent),
      adm_nitrado_read_failure_message: admNitradoReadFailure && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent) ? admNitradoReadFailureMessage : null,
      warnings,
      warning_messages: admNitradoReadFailure && !(currentLiveAdm.healthy && !backlogIssueAppliesToCurrent) ? {
        adm_nitrado_read_failure: admNitradoReadFailureMessage,
      } : {},
    };
    return json({ ...payload, data: payload }, {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return dashboardHealthError(500, "dashboard_health_failed", "Unable to load dashboard health snapshot.", sanitize(error));
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });

function sanitizeId(value: unknown) {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === "string" && /^[a-zA-Z0-9_-]{3,128}$/.test(id) ? id : null;
}

function statsFromRow(stats: StatsRow | null, server: ServerRow) {
  return {
    players: numberOrZero(server.current_players),
    kills: numberOrZero(stats?.total_kills),
    deaths: numberOrZero(stats?.total_deaths),
    joins: numberOrZero(stats?.total_joins),
    disconnects: numberOrZero(stats?.total_disconnects),
    unique_players: numberOrZero(stats?.unique_players),
  };
}

function normalizeJob(job: JobRow) {
  const chunkSize = Math.max(1, numberOrZero(job.chunk_size) || 10);
  const totalLines = numberOrZero(job.total_lines);
  const calculatedTotalChunks = Math.max(1, Math.ceil(Math.max(1, totalLines) / chunkSize));
  const totalChunks = Math.max(calculatedTotalChunks, numberOrZero(job.total_chunks), numberOrZero(job.chunks_processed));
  const currentChunk = Math.max(0, Math.min(totalChunks, numberOrZero(job.chunks_processed)));
  return {
    id: job.id,
    job_id: job.id,
    filename: job.filename,
    source: job.source,
    status: job.status,
    current_line: numberOrZero(job.current_line),
    total_lines: totalLines,
    current_chunk: currentChunk,
    total_chunks: totalChunks,
    chunks_processed: currentChunk,
    parsed_kills: numberOrZero(job.parsed_kills),
    written_kills: numberOrZero(job.written_kills),
    duplicate_skips: numberOrZero(job.duplicate_skips),
    joins: numberOrZero(job.joins),
    disconnects: numberOrZero(job.disconnects),
    playerlist_snapshots: numberOrZero(job.playerlist_snapshots),
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    error_message: sanitize(job.error_message),
  };
}

function normalizeRecentEvent(event: RecentEventRow) {
  return {
    source: event.source,
    event_type: event.event_type,
    player_name: event.player_name,
    killer_name: event.killer_name,
    victim_name: event.victim_name,
    weapon: event.weapon,
    distance: event.distance,
    occurred_at: event.occurred_at,
    created_at: event.created_at,
    event_label: event.event_label ?? event.event_type,
    detail: event.detail,
    cause: event.cause,
    object_type: event.object_type,
    is_mock: Number(event.is_mock) === 1,
  };
}

function cronSnapshot(rows: CronRow[], now: string) {
  const latest = (jobType: string) => rows.find((row) => row.job_type === jobType) ?? null;
  const metadata = latest("metadata");
  const adm = latest("adm");
  const discord = latest("discord-posts");
  return {
    metadata_recent: isRecent(metadata?.created_at, now, 10),
    adm_recent: isRecent(adm?.created_at, now, 10),
    discord_recent: isRecent(discord?.created_at, now, 20),
    metadata,
    adm,
    discord,
  };
}

function isRecent(value: string | null | undefined, now: string, maxAgeMinutes: number) {
  if (!value) return false;
  const age = Date.parse(now) - Date.parse(value);
  return Number.isFinite(age) && age <= maxAgeMinutes * 60_000;
}

function latestEventAt(events: Array<{ occurred_at: string | null; created_at: string | null }>) {
  return events
    .map((event) => event.occurred_at ?? event.created_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function setupProgress(input: { hasGuild: boolean; hasService: boolean; hasAdm: boolean; hasStats: boolean }) {
  const checks = [
    ["Discord Connected", input.hasGuild],
    ["Nitrado Connected", input.hasService],
    ["ADM Detected", input.hasAdm],
    ["Stats Sync Active", input.hasStats],
  ] as const;
  const completed = checks.filter(([, done]) => done).length;
  return {
    percent: Math.round((completed / checks.length) * 100),
    checks: checks.map(([label, done]) => ({ label, done })),
  };
}

function normalizeLatestReadTruth(issue: AdmFileReadIssueRow | null, diagnostic: NitradoFileReadDiagnosticRow | null): AdmFileReadIssueRow | null {
  const issueTime = Date.parse(issue?.last_diagnostic_at ?? issue?.last_checked_at ?? "");
  const diagnosticTime = Date.parse(diagnostic?.created_at ?? "");
  if (diagnostic && (!issue || (Number.isFinite(diagnosticTime) && (!Number.isFinite(issueTime) || diagnosticTime >= issueTime)))) {
    return {
      adm_file: diagnostic.file_name,
      file_path: diagnostic.file_path,
      status: diagnostic.status,
      retry_count: issue?.retry_count ?? 0,
      next_retry_at: issue?.next_retry_at ?? null,
      last_http_status: diagnostic.http_status,
      last_endpoint_kind: diagnostic.endpoint_kind,
      last_method: diagnostic.method,
      last_error: diagnostic.error_code ?? diagnostic.error_message,
      last_diagnostic_at: diagnostic.created_at,
      last_checked_at: diagnostic.created_at,
    };
  }
  return issue;
}

function classifyAdmReadIssue(issue: AdmFileReadIssueRow | null, fallback: string | null | undefined) {
  const httpStatus = numberOrNull(issue?.last_http_status);
  const error = sanitize(issue?.last_error ?? fallback ?? "");
  if (isSuccessfulAdmActivity(error)) return null;
  if (httpStatus && httpStatus >= 500 && httpStatus <= 504) return `HTTP ${httpStatus} / NITRADO_UPSTREAM_DOWN`;
  if (httpStatus === 429) return "HTTP 429 / NITRADO_RATE_LIMITED";
  if (httpStatus === 401) return "HTTP 401 / NITRADO_UNAUTHORIZED";
  if (httpStatus === 403) return "HTTP 403 / NITRADO_FORBIDDEN";
  if (httpStatus === 404) return "HTTP 404 / NITRADO_FILE_NOT_FOUND";
  if (/WORKER_SUBREQUEST_LIMIT/i.test(error)) return "WORKER_SUBREQUEST_LIMIT";
  if (/FETCH_TIMEOUT/i.test(error)) return "FETCH_TIMEOUT";
  if (/FETCH_THREW/i.test(error)) return "FETCH_THREW";
  if (/TOKENIZED_EMPTY_BODY/i.test(error)) return "TOKENIZED_EMPTY_BODY";
  return error || null;
}

function formatAdmReadIssueMessage(issue: AdmFileReadIssueRow | null, fallback: string | null | undefined) {
  const status = numberOrNull(issue?.last_http_status);
  const retrySuffix = issue?.next_retry_at ? ` Retry scheduled for ${issue.next_retry_at}.` : " Auto-sync will retry.";
  if (status && status >= 500 && status <= 504) {
    return `Nitrado file service returned HTTP ${status} for ADM file reads.${retrySuffix}`;
  }
  if (status === 429) {
    return `Nitrado rate-limited ADM file reads with HTTP 429.${retrySuffix}`;
  }
  if (status === 401 || status === 403) {
    return `Nitrado returned HTTP ${status} for ADM file reads. Reconnect Nitrado or check file permissions.`;
  }
  if (status === 404) {
    return `Nitrado listed an ADM file but returned HTTP 404 when DZN tried to read it. DZN will skip it and continue with other eligible files.`;
  }
  const message = sanitize(issue?.last_error ?? fallback ?? "");
  if (isSuccessfulAdmActivity(message)) return "ADM imported successfully.";
  if (/WORKER_SUBREQUEST_LIMIT/i.test(message)) return "Cloudflare Worker subrequest budget was reached before ADM file read completed. Auto-sync will continue in the next small batch.";
  if (/FETCH_TIMEOUT/i.test(message)) return `Nitrado ADM file read timed out.${retrySuffix}`;
  if (/TOKENIZED_EMPTY_BODY/i.test(message)) return `Nitrado tokenized ADM download returned an empty body.${retrySuffix}`;
  return message || null;
}

function canonicalAdmErrorCode(value: string | null) {
  const text = String(value ?? "");
  if (isSuccessfulAdmActivity(text)) return null;
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

function isSuccessfulAdmActivity(value: string | null | undefined) {
  return /ADM chunk import completed|Scheduled ADM import completed|Manual ADM import completed|completed in \d+ chunks?|ADM backfill is caught up|is caught up at \d+ lines|already imported|processed successfully/i.test(String(value ?? ""));
}

function ownerAutoSyncStatus(activeJob: ReturnType<typeof normalizeJob> | null, code: string | null, server: ServerRow, stats: ReturnType<typeof statsFromRow>) {
  if (activeJob) return "importing";
  if (code === "NITRADO_UNAUTHORIZED" || code === "NITRADO_FORBIDDEN") return "needs_attention";
  if (code === "NITRADO_UPSTREAM_DOWN" || code === "NITRADO_RATE_LIMITED" || code === "FETCH_TIMEOUT" || code === "FETCH_THREW" || code === "TOKENIZED_EMPTY_BODY" || code === "WORKER_SUBREQUEST_LIMIT") return "waiting_for_nitrado";
  if (server.last_processed_adm_filename || stats.kills > 0 || stats.joins > 0 || stats.unique_players > 0) return "healthy";
  return "waiting_for_nitrado";
}

function ownerAutoSyncHeadline(activeJob: ReturnType<typeof normalizeJob> | null, code: string | null, server: ServerRow, stats: ReturnType<typeof statsFromRow>) {
  const status = ownerAutoSyncStatus(activeJob, code, server, stats);
  if (status === "importing") return "Importing ADM data";
  if (status === "needs_attention") return "Nitrado connection needs attention";
  if (code === "NITRADO_UPSTREAM_DOWN") return "Nitrado file service waiting";
  if (status === "waiting_for_nitrado") return "Waiting for readable ADM";
  return "Auto sync active";
}

function ownerAutoSyncMessage(activeJob: ReturnType<typeof normalizeJob> | null, code: string | null, httpStatus: number | null, readMessage: string | null) {
  if (activeJob) return `DZN is processing ${activeJob.filename || "the latest readable ADM file"} automatically.`;
  if (readMessage) return readMessage;
  if (code === "NITRADO_UPSTREAM_DOWN") return `Nitrado returned an upstream error${httpStatus ? ` HTTP ${httpStatus}` : ""} for ADM reads. DZN will retry automatically.`;
  if (code === "NITRADO_RATE_LIMITED") return "Nitrado rate limited ADM reads. DZN is backing off and will retry automatically.";
  if (code === "NITRADO_UNAUTHORIZED") return "DZN cannot access your Nitrado files. Reconnect Nitrado from server settings.";
  if (code === "NITRADO_FORBIDDEN") return "Your token works for metadata but not file reads. Reconnect Nitrado or check service access.";
  if (code === "NITRADO_FILE_NOT_FOUND") return "The ADM file was listed but is no longer readable. DZN will continue with the next available ADM.";
  return "DZN automatically discovers, retries, and imports ADM data without manual action.";
}

function ownerAdmSource(issue: AdmFileReadIssueRow | null, activeJob: ReturnType<typeof normalizeJob> | null, preferredSource?: SourceStateRow | null) {
  if (/noftp|gameserver_details_log_files/i.test(String(preferredSource?.source_name ?? "")) && Number(preferredSource?.works ?? 0) === 1) return "Nitrado Log Files";
  if (/admin_logs/i.test(String(preferredSource?.source_name ?? "")) && Number(preferredSource?.works ?? 0) === 1) return "Nitrado Admin Logs";
  const sourceText = `${issue?.last_endpoint_kind ?? ""} ${issue?.last_method ?? ""} ${issue?.file_path ?? ""}`;
  if (/noftp|gameserver_details_log_files/i.test(sourceText)) return "Nitrado Log Files";
  if (issue?.last_endpoint_kind === "nitrado_admin_logs" || issue?.last_method === "admin_logs") return "Nitrado Admin Logs";
  if (issue?.last_endpoint_kind === "nitrado_seek" || issue?.last_endpoint_kind === "nitrado_download" || issue?.last_endpoint_kind === "tokenized_url") return "Nitrado File Server fallback";
  if (activeJob?.source === "scheduled_nitrado") return "Scheduled Nitrado ADM import";
  return "Automatic ADM tracking";
}

function buildCurrentLiveAdmStatus(
  fileState: AdmFileReadIssueRow | null,
  activeJob: ReturnType<typeof normalizeJob> | null,
  latestCompletedImport: CompletedImportRow | null,
  server: ServerRow,
  stats: ReturnType<typeof statsFromRow>,
  preferredSource?: SourceStateRow | null,
) {
  const cursorLine = Math.max(
    numberOrZero(fileState?.cursor_line),
    numberOrZero(fileState?.imported_line_count),
    numberOrZero(fileState?.line_count),
  );
  const fileStatus = String(fileState?.status ?? "").toLowerCase();
  const source = ownerAdmSource(fileState, activeJob, preferredSource);
  const active = Boolean(activeJob);
  const caughtUp = ["caught_up_waiting_for_growth", "processed", "completed_empty", "completed_closed"].includes(fileStatus);
  const completedCurrent = Boolean(
    latestCompletedImport?.filename
    && fileState?.adm_file
    && normalizeAdmFilename(latestCompletedImport.filename) === normalizeAdmFilename(fileState.adm_file),
  );
  const hasStats = stats.kills > 0 || stats.deaths > 0 || stats.joins > 0 || stats.disconnects > 0 || stats.unique_players > 0;
  const processedCurrent = Boolean(
    server.last_processed_adm_filename
    && fileState?.adm_file
    && normalizeAdmFilename(server.last_processed_adm_filename) === normalizeAdmFilename(fileState.adm_file),
  );
  const healthy = active || caughtUp || completedCurrent || processedCurrent || cursorLine > 0 || hasStats;
  const status = active
    ? "importing"
    : caughtUp
      ? "caught_up_waiting_for_growth"
      : completedCurrent || processedCurrent
        ? "completed_current"
        : cursorLine > 0
          ? "caught_up_waiting_for_growth"
          : fileState?.next_retry_at
            ? "retry_scheduled"
            : null;
  return {
    healthy,
    currentFile: fileState?.adm_file ?? server.newest_available_adm_filename ?? server.latest_adm_file ?? latestCompletedImport?.filename ?? null,
    currentSource: source,
    currentCursorLine: cursorLine,
    currentLatestKnownLineCount: Math.max(numberOrZero(fileState?.latest_known_line_count), numberOrZero(fileState?.line_count)),
    status,
    lastReadAt: fileState?.last_read_at ?? fileState?.last_checked_at ?? null,
    lastGrowthAt: fileState?.last_growth_at ?? null,
    completedAt: fileState?.completed_at ?? latestCompletedImport?.completed_at ?? latestCompletedImport?.updated_at ?? null,
    nextRetryAt: fileState?.next_retry_at ?? null,
  };
}

function ownerLatestAdmState(activeJob: ReturnType<typeof normalizeJob> | null, code: string | null, server: ServerRow, latestCompletedImport: CompletedImportRow | null) {
  if (activeJob) return "importing";
  if (code === "NITRADO_UPSTREAM_DOWN") return "nitrado_file_service_unavailable";
  if (code === "NITRADO_RATE_LIMITED") return "retry_scheduled";
  if (code === "NITRADO_UNAUTHORIZED" || code === "NITRADO_FORBIDDEN") return "needs_attention";
  if (code === "NITRADO_FILE_NOT_FOUND") return "file_missing_or_rotated";
  if (latestCompletedImport || server.last_successful_sync_at || server.last_processed_adm_filename) return "adm_imported";
  if (server.newest_available_adm_filename || server.latest_adm_file) return "latest_adm_unreadable";
  return "waiting_for_adm";
}

function numberOrZero(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitize(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 500);
}

function normalizeAdmFilename(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/DayZServer_PS4_x64_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.ADM/i);
  return (match?.[0] ?? text.split(/[\\/]/).pop() ?? text).toLowerCase();
}

function dashboardHealthError(status: number, errorCode: string, message: string, details?: string | null) {
  return json({
    ok: false,
    error_code: errorCode,
    message,
    details: details ?? null,
    generated_at: new Date().toISOString(),
    stale: false,
    source: "error",
  }, { status });
}
