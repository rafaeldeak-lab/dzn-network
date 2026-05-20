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
  last_successful_sync_at: string | null;
  last_sync_message: string | null;
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

    const db = requireDb(env);
    const now = new Date().toISOString();
    const [server, stats, recentEvents, activeJob, queuedJobs, completedToday, fileState, cronRows] = await Promise.all([
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
                adm_sync_state.last_successful_sync_at,
                adm_sync_state.last_sync_message
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
         ORDER BY created_at ASC
         LIMIT 1`,
      ).bind(linkedServerId).first<JobRow>().catch(() => null),
      db.prepare(
        "SELECT COUNT(*) AS count FROM adm_import_jobs WHERE server_id = ? AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable')",
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
        `SELECT job_type, status, source, created_at
         FROM automation_cron_runs
         WHERE source = 'cloudflare'
         ORDER BY created_at DESC
         LIMIT 30`,
      ).all<CronRow>().catch(() => ({ results: [] as CronRow[] })),
    ]);

    if (!server) return dashboardHealthError(404, "server_not_found", "Server not found.");

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
    const admStatus = activeJobSnapshot
      ? "Importing ADM"
      : server.newest_available_adm_filename && !server.newest_readable_adm_filename
        ? "Waiting for Nitrado"
        : statsSnapshot.kills > 0 || statsSnapshot.joins > 0 || server.last_processed_adm_filename
          ? "ADM Sync Active"
          : "Waiting for Nitrado";
    const warnings = [
      ...(!cron.adm_recent ? ["adm_cron_stale"] : []),
      ...(fileState && numberOrZero(fileState.missing_count) > 0 ? ["adm_backfill_missing"] : []),
      ...(fileState && numberOrZero(fileState.unreadable_count) > 0 ? ["nitrado_read_waiting"] : []),
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
        newest_available_adm_filename: server.newest_available_adm_filename,
        newest_readable_adm_filename: server.newest_readable_adm_filename,
        last_processed_adm_filename: server.last_processed_adm_filename ?? server.latest_adm_file,
        last_successful_sync: server.last_successful_sync_at ?? server.last_sync_at,
        next_adm_discovery_due_at: server.next_adm_discovery_due_at,
        next_adm_processing_due_at: server.next_adm_pull_due_at,
        last_error: sanitize(server.last_adm_discovery_error ?? server.last_sync_message),
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
      warnings,
    };
    return json({ ...payload, data: payload }, {
      headers: {
        "cache-control": "private, no-store",
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
