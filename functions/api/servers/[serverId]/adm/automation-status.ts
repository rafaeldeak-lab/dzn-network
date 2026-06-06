import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { effectiveEntitlementPlan, getAdmDiscoveryIntervalMinutes, getAdmPullInterval, getServerStatusInterval, normalizePlanKey } from "../../../../_lib/plans";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import { calculateServerScore } from "../../../../_lib/server-ranking";
import { getCanonicalServerStats } from "../../../../_lib/server-stats";
import type { PagesFunction } from "../../../../_lib/types";

type CronRow = {
  source: string | null;
  job_type: string | null;
  status: string | null;
  error_message: string | null;
  started_at: string | null;
  created_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  processed_count: number | null;
  skipped_count: number | null;
  failed_count: number | null;
};

type ServerSnapshotRow = {
  id: string;
  guild_id: string | null;
  public_slug: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  linked_status: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  newest_available_adm_filename: string | null;
  newest_available_adm_timestamp: string | null;
  newest_readable_adm_filename: string | null;
  newest_readable_adm_timestamp: string | null;
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
  last_adm_discovery_error: string | null;
  adm_discovery_status: string | null;
  last_processed_adm_filename: string | null;
  last_successful_adm_sync_at: string | null;
  last_adm_error: string | null;
  latest_adm_file: string | null;
  last_sync_status: string | null;
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
  error_message: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

type FileStateRow = {
  adm_file: string;
  status: string;
  last_error: string | null;
  updated_at: string | null;
};

type StatsRow = {
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  longest_kill: number | null;
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return automationStatusError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed) {
      return automationStatusError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const db = requireDb(env);
    const now = new Date().toISOString();
    const [server, cronRows, activeJob, queuedJobsResult, completedJobsResult, fileStatesResult, stats, recentEvents, discordQueue, canonicalStats] = await Promise.all([
      db
        .prepare(
          `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
                  linked_servers.nitrado_service_id, linked_servers.display_name,
                  linked_servers.hostname, linked_servers.server_name,
                  linked_servers.status AS linked_status,
                  server_subscriptions.plan_key, server_subscriptions.status AS subscription_status,
                  server_sync_state.newest_available_adm_filename,
                  server_sync_state.newest_available_adm_timestamp,
                  server_sync_state.newest_readable_adm_filename,
                  server_sync_state.newest_readable_adm_timestamp,
                  server_sync_state.last_adm_discovery_check_at,
                  server_sync_state.next_adm_discovery_due_at,
                  server_sync_state.next_adm_pull_due_at,
                  server_sync_state.last_adm_discovery_error,
                  server_sync_state.adm_discovery_status,
                  adm_sync_state.last_processed_file AS last_processed_adm_filename,
                  adm_sync_state.last_sync_at AS last_successful_adm_sync_at,
                  adm_sync_state.last_sync_message AS last_adm_error,
                  adm_sync_state.latest_adm_file,
                  adm_sync_state.last_sync_status
           FROM linked_servers
           LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
           LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
           LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
           WHERE linked_servers.id = ?
           LIMIT 1`,
        )
        .bind(linkedServerId)
        .first<ServerSnapshotRow>(),
      db
        .prepare(
          `SELECT source, job_type, status, error_message, started_at, created_at, finished_at,
                  duration_ms, processed_count, skipped_count, failed_count
           FROM automation_cron_runs
           ORDER BY created_at DESC
           LIMIT 60`,
        )
        .all<CronRow>()
        .catch(() => ({ results: [] as CronRow[] })),
      db
        .prepare(
          `SELECT id, filename, source, status, total_lines, current_line, chunk_size,
                  total_chunks, chunks_processed, parsed_kills, written_kills,
                  duplicate_skips, joins, disconnects, playerlist_snapshots,
                  error_message, created_at, updated_at, completed_at
           FROM adm_import_jobs
           WHERE server_id = ?
             AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable')
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .bind(linkedServerId)
        .first<JobRow>()
        .catch(() => null),
      db
        .prepare(
          `SELECT id, filename, source, status, total_lines, current_line, chunk_size,
                  total_chunks, chunks_processed, parsed_kills, written_kills,
                  duplicate_skips, joins, disconnects, playerlist_snapshots,
                  error_message, created_at, updated_at, completed_at
           FROM adm_import_jobs
           WHERE server_id = ?
             AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable')
           ORDER BY created_at ASC
           LIMIT 8`,
        )
        .bind(linkedServerId)
        .all<JobRow>()
        .catch(() => ({ results: [] as JobRow[] })),
      db
        .prepare(
          `SELECT id, filename, source, status, total_lines, current_line, chunk_size,
                  total_chunks, chunks_processed, parsed_kills, written_kills,
                  duplicate_skips, joins, disconnects, playerlist_snapshots,
                  error_message, created_at, updated_at, completed_at
           FROM adm_import_jobs
           WHERE server_id = ?
             AND status IN ('completed', 'completed_with_warnings')
           ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
           LIMIT 8`,
        )
        .bind(linkedServerId)
        .all<JobRow>()
        .catch(() => ({ results: [] as JobRow[] })),
      db
        .prepare(
          `SELECT adm_file, status, last_error, updated_at
           FROM adm_sync_file_state
           WHERE linked_server_id = ?
           ORDER BY adm_file ASC
           LIMIT 40`,
        )
        .bind(linkedServerId)
        .all<FileStateRow>()
        .catch(() => ({ results: [] as FileStateRow[] })),
      db
        .prepare(
          `SELECT total_kills, total_deaths, total_joins, total_disconnects,
                  unique_players,
                  COALESCE((SELECT MAX(COALESCE(distance, 0)) FROM kill_events WHERE linked_server_id = ?), 0) AS longest_kill
           FROM server_stats
           WHERE linked_server_id = ?
           LIMIT 1`,
        )
        .bind(linkedServerId, linkedServerId)
        .first<StatsRow>()
        .catch(() => null),
      db
        .prepare(
          `SELECT COUNT(*) AS count,
                  MAX(latest_at) AS latest_event_at
           FROM (
             SELECT COALESCE(occurred_at, created_at) AS latest_at FROM kill_events WHERE linked_server_id = ?
             UNION ALL
             SELECT COALESCE(occurred_at, created_at) AS latest_at FROM player_events WHERE linked_server_id = ?
           )`,
        )
        .bind(linkedServerId, linkedServerId)
        .first<{ count: number | null; latest_event_at: string | null }>()
        .catch(() => ({ count: 0, latest_event_at: null })),
      db
        .prepare("SELECT COUNT(*) AS count FROM automation_jobs WHERE guild_id = ? AND job_type = 'discord-post-update' AND status IN ('queued', 'running')")
        .bind(access.server?.guild_id ?? "")
        .first<{ count: number | null }>()
        .catch(() => ({ count: 0 })),
      getCanonicalServerStats(db, linkedServerId).catch(() => null),
    ]);

    if (!server) return automationStatusError(404, "server_not_found", "Server not found.");

    const planKey = normalizePlanKey(server.plan_key);
    const effectivePlanKey = effectiveEntitlementPlan(planKey, server.subscription_status);
    const statsSnapshot = canonicalStats ? buildStatsSnapshotFromCanonical(canonicalStats) : buildStatsSnapshot(stats);
    const completedJobs = completedJobsResult.results ?? [];
    const completedFiles = new Set(completedJobs.map((job) => job.filename));
    if (server.last_processed_adm_filename) completedFiles.add(server.last_processed_adm_filename);
    const fileStates = fileStatesResult.results ?? [];
    const missingFiles = fileStates
      .filter((file) => !completedFiles.has(file.adm_file) && ["discovered", "unreadable", "parser_error", "write_error", "partial"].includes(file.status))
      .map((file) => file.adm_file);
    const unreadableFiles = fileStates.filter((file) => file.status === "unreadable");
    const cron = buildCronSnapshot(cronRows.results ?? [], now);
    const activeJobSnapshot = activeJob ? normalizeJobSnapshot(activeJob) : null;
    const problemFlags = buildProblemFlags({
      cronHealthy: cron.cron_healthy,
      activeJob: activeJobSnapshot,
      missingFilesCount: missingFiles.length,
      unreadableFilesCount: unreadableFiles.length,
      subscriptionStatus: server.subscription_status,
      effectivePlanKey,
      admDiscoveryStatus: server.adm_discovery_status,
      newestAvailable: server.newest_available_adm_filename,
      newestReadable: server.newest_readable_adm_filename,
    });

    return automationStatusJson({
      ok: true,
      checked_at: now,
      server: {
        id: server.id,
        guild_id: server.guild_id,
        public_slug: server.public_slug,
        name: server.display_name ?? server.hostname ?? server.server_name,
        status: server.linked_status,
      },
      server_id: server.id,
      service_id: server.nitrado_service_id,
      plan: {
        plan_key: effectivePlanKey,
        configured_plan_key: planKey,
        subscription_status: server.subscription_status,
        status_interval_minutes: getServerStatusInterval(effectivePlanKey),
        adm_discovery_interval_minutes: getAdmDiscoveryIntervalMinutes(effectivePlanKey),
        adm_processing_interval_minutes: getAdmPullInterval(effectivePlanKey),
      },
      cron,
      nitrado: {
        service_id: server.nitrado_service_id,
        newest_available_adm_filename: server.newest_available_adm_filename,
        newest_readable_adm_filename: server.newest_readable_adm_filename,
        newest_readable: Boolean(server.newest_readable_adm_filename && server.newest_readable_adm_filename === server.newest_available_adm_filename),
        last_read_error: sanitizeDiagnosticText(server.last_adm_discovery_error ?? server.last_adm_error),
      },
      adm: {
        newest_available_adm_filename: server.newest_available_adm_filename,
        newest_available_adm_timestamp: server.newest_available_adm_timestamp,
        newest_readable_adm_filename: server.newest_readable_adm_filename,
        newest_readable_adm_timestamp: server.newest_readable_adm_timestamp,
        last_processed_adm_filename: server.last_processed_adm_filename,
        last_successful_adm_sync_at: server.last_successful_adm_sync_at,
        last_adm_discovery_check_at: server.last_adm_discovery_check_at,
        next_adm_discovery_due_at: server.next_adm_discovery_due_at,
        next_adm_processing_due_at: server.next_adm_pull_due_at,
        last_adm_error: sanitizeDiagnosticText(server.last_adm_discovery_error ?? server.last_adm_error),
        discovery_status: server.adm_discovery_status,
        last_sync_status: server.last_sync_status,
      },
      active_job: activeJobSnapshot,
      queued_jobs: (queuedJobsResult.results ?? []).map(normalizeJobSnapshot),
      latest_completed_job: completedJobs[0] ? normalizeJobSnapshot(completedJobs[0]) : null,
      completed_jobs: completedJobs.map(normalizeJobSnapshot),
      recent_imports: completedJobs.map(normalizeJobSnapshot),
      missing_files: missingFiles,
      unreadable_files: unreadableFiles.map((file) => ({
        filename: file.adm_file,
        status: file.status,
        last_error: sanitizeDiagnosticText(file.last_error),
        updated_at: file.updated_at,
      })),
      latest_events: {
        recent_events_count: numberOrZero(recentEvents?.count),
        latest_event_at: recentEvents?.latest_event_at ?? null,
      },
      recent_events_count: numberOrZero(recentEvents?.count),
      latest_event_at: recentEvents?.latest_event_at ?? null,
      stats: {
        ...statsSnapshot,
        score: calculateServerScore({
          kills: statsSnapshot.kills,
          deaths: statsSnapshot.deaths,
          uniquePlayers: statsSnapshot.unique_players,
          joins: statsSnapshot.joins,
          longestKill: canonicalStats ? canonicalStats.longestKill : numberOrZero(stats?.longest_kill),
          statsSyncActive: Boolean(server.last_processed_adm_filename || completedJobs.length || activeJobSnapshot),
        }),
      },
      discord: {
        queued_post_jobs: numberOrZero(discordQueue?.count),
      },
      problem_flags: problemFlags,
      next_action: getNextAction({
        activeJob: activeJobSnapshot,
        missingFiles,
        unreadableFilesCount: unreadableFiles.length,
        effectivePlanKey,
        subscriptionStatus: server.subscription_status,
        cronHealthy: cron.cron_healthy,
      }),
    });
  } catch (error) {
    return automationStatusError(500, "adm_automation_status_failed", "Unable to read ADM automation status.", debugDetails(request, error));
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });

function buildStatsSnapshotFromCanonical(stats: Awaited<ReturnType<typeof getCanonicalServerStats>>) {
  return {
    kills: stats.kills,
    deaths: stats.deaths,
    joins: stats.joins,
    disconnects: stats.disconnects,
    unique_players: stats.uniquePlayers,
  };
}

function buildStatsSnapshot(stats: StatsRow | null) {
  return {
    kills: numberOrZero(stats?.total_kills),
    deaths: numberOrZero(stats?.total_deaths),
    joins: numberOrZero(stats?.total_joins),
    disconnects: numberOrZero(stats?.total_disconnects),
    unique_players: numberOrZero(stats?.unique_players),
  };
}

function buildCronSnapshot(rows: CronRow[], now: string) {
  const rowsWithAge = rows.map((row) => ({ ...row, age_minutes: ageMinutes(row.created_at, now) }));
  const cloudflareLastMetadata = rowsWithAge.find((row) => row.source === "cloudflare" && row.job_type === "metadata") ?? null;
  const cloudflareLastAdm = rowsWithAge.find((row) => row.source === "cloudflare" && row.job_type === "adm") ?? null;
  const cloudflareLastDiscordPosts = rowsWithAge.find((row) => row.source === "cloudflare" && row.job_type === "discord-posts") ?? null;
  const latestCloudflare = rowsWithAge.find((row) => row.source === "cloudflare") ?? null;
  const cronHealthy = Boolean(
    latestCloudflare &&
    ageMinutes(latestCloudflare.created_at, now) !== null &&
    ageMinutes(latestCloudflare.created_at, now)! <= 5 &&
    cloudflareLastAdm &&
    ageMinutes(cloudflareLastAdm.created_at, now) !== null &&
    ageMinutes(cloudflareLastAdm.created_at, now)! <= 5,
  );
  return {
    cloudflare_last_metadata: cloudflareLastMetadata,
    cloudflare_last_adm: cloudflareLastAdm,
    cloudflare_last_discord_posts: cloudflareLastDiscordPosts,
    latest_cloudflare: latestCloudflare,
    cron_healthy: cronHealthy,
  };
}

function normalizeJobSnapshot(job: JobRow) {
  const totalLines = numberOrZero(job.total_lines);
  const currentLine = Math.max(0, Math.min(totalLines, numberOrZero(job.current_line)));
  const chunkSize = Math.max(1, numberOrZero(job.chunk_size) || 10);
  const calculatedTotalChunks = Math.max(1, Math.ceil(Math.max(totalLines, 1) / chunkSize));
  const rawTotalChunks = Math.max(1, numberOrZero(job.total_chunks));
  const rawChunksProcessed = Math.max(0, numberOrZero(job.chunks_processed));
  const chunksFromLine = currentLine >= totalLines && totalLines > 0 ? calculatedTotalChunks : Math.ceil(currentLine / chunkSize);
  const totalChunks = Math.max(rawTotalChunks, calculatedTotalChunks, rawChunksProcessed, chunksFromLine);
  const chunksProcessed = Math.max(0, Math.min(totalChunks, Math.max(rawChunksProcessed, chunksFromLine)));
  return {
    id: job.id,
    job_id: job.id,
    filename: job.filename,
    source: job.source,
    status: job.status,
    current_line: currentLine,
    total_lines: totalLines,
    current_chunk: currentLine >= totalLines && totalLines > 0 ? totalChunks : Math.max(1, Math.min(totalChunks, chunksProcessed + 1)),
    total_chunks: totalChunks,
    chunks_processed: chunksProcessed,
    parsed_kills: numberOrZero(job.parsed_kills),
    written_kills: numberOrZero(job.written_kills),
    duplicate_skips: numberOrZero(job.duplicate_skips),
    joins: numberOrZero(job.joins),
    disconnects: numberOrZero(job.disconnects),
    playerlist_snapshots: numberOrZero(job.playerlist_snapshots),
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    error_message: sanitizeDiagnosticText(job.error_message),
    chunk_count_normalized: totalChunks !== rawTotalChunks,
  };
}

function buildProblemFlags(input: {
  cronHealthy: boolean;
  activeJob: ReturnType<typeof normalizeJobSnapshot> | null;
  missingFilesCount: number;
  unreadableFilesCount: number;
  subscriptionStatus: string | null;
  effectivePlanKey: string;
  admDiscoveryStatus: string | null;
  newestAvailable: string | null;
  newestReadable: string | null;
}) {
  const flags: string[] = [];
  if (input.cronHealthy) flags.push("cron_healthy");
  else flags.push("cron_stale");
  if (input.activeJob) flags.push("adm_job_processing");
  if (input.activeJob?.updated_at && ageMinutes(input.activeJob.updated_at, new Date().toISOString()) !== null && ageMinutes(input.activeJob.updated_at, new Date().toISOString())! > 5) flags.push("adm_job_stale");
  if (input.missingFilesCount > 0) flags.push("adm_backfill_missing");
  if (input.unreadableFilesCount > 0 || input.admDiscoveryStatus === "latest_adm_unreadable" || (input.newestAvailable && input.newestAvailable !== input.newestReadable)) flags.push("nitrado_read_waiting");
  if (!["active", "trialing"].includes((input.subscriptionStatus ?? "").toLowerCase())) flags.push("subscription_not_active");
  if (input.effectivePlanKey === "free") flags.push("adm_processing_limited_by_plan");
  return flags;
}

function getNextAction(input: {
  activeJob: ReturnType<typeof normalizeJobSnapshot> | null;
  missingFiles: string[];
  unreadableFilesCount: number;
  effectivePlanKey: string;
  subscriptionStatus: string | null;
  cronHealthy: boolean;
}) {
  if (!["active", "trialing"].includes((input.subscriptionStatus ?? "").toLowerCase()) || input.effectivePlanKey === "free") {
    return "Restore an active paid plan before heavy ADM automation runs.";
  }
  if (input.activeJob) return `Continue ${input.activeJob.filename} chunk ${input.activeJob.current_chunk}/${input.activeJob.total_chunks}.`;
  if (input.missingFiles.length) return `Queue/import oldest missing ADM file ${input.missingFiles[0]}.`;
  if (input.unreadableFilesCount > 0) return "Retry unreadable Nitrado ADM files on the next discovery run.";
  if (!input.cronHealthy) return "Check Cloudflare cron freshness.";
  return "ADM automation is caught up and waiting for the next Nitrado ADM file.";
}

function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function ageMinutes(value: string | null | undefined, now: string) {
  if (!value) return null;
  const start = Date.parse(value);
  const end = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizeDiagnosticText(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .slice(0, 700);
}

function automationStatusJson(result: unknown) {
  return json(result, { headers: { "cache-control": "private, no-store, no-cache, must-revalidate", vary: "Cookie" } });
}

function automationStatusError(status: number, errorCode: string, message: string, details: unknown = null) {
  return json({ ok: false, error_code: errorCode, message, details }, {
    status,
    headers: { "cache-control": "private, no-store, no-cache, must-revalidate", vary: "Cookie" },
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
