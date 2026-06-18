import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";
import { isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";

type MetadataSyncRunBody = {
  async?: boolean;
  cron?: string;
  debug_service_id?: string;
  deadline_ms?: number;
  player_count_stale_ms?: number;
  source?: string;
  max_servers?: number;
};

type MetadataSyncRunHandlers = {
  refreshMetadata: (env: Env, options?: Record<string, unknown>) => Promise<MetadataRefreshResult>;
};

type MetadataRefreshResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  updated_player_counts: number;
  budget_exhausted?: boolean;
  results: Array<{
    linked_server_id: string;
    service_id: string | null;
    server_name: string | null;
    status: "succeeded" | "failed" | "skipped";
    changed: boolean;
    current_players: number | null;
    max_players: number | null;
    player_count_status: string;
    player_count_last_checked_at: string | null;
    metadata_last_checked_at: string | null;
    message: string;
  }>;
};

type MetadataRefreshOptions = {
  maxServers: number;
  deadlineMs: number;
  livePlayerCountStaleMs: number;
  includeResults: boolean;
  queueDiscordUpdates: boolean;
  skipAutomationMaintenance: boolean;
  debugServiceId: string | null;
};

export const onRequestPost: PagesFunction = (context) => handleMetadataSyncRun(context);

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    Allow: "POST, OPTIONS",
  },
});

export const onRequestGet: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["POST"] },
  {
    status: 405,
    headers: {
      Allow: "POST",
    },
  },
);

export async function handleMetadataSyncRun(
  { request, env, waitUntil }: PagesContext,
  handlers?: MetadataSyncRunHandlers,
) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const body = await readJson<MetadataSyncRunBody>(request);

  const source = normalizeAutomationCronSource(body.source, body.cron);
  const startedAt = new Date().toISOString();
  const debugServiceId = sanitizeServiceId(body.debug_service_id);
  const refreshOptions = {
    maxServers: sanitizePositiveInteger(body.max_servers, 1, 5),
    deadlineMs: sanitizePositiveInteger(body.deadline_ms, 2_500, 5_000),
    livePlayerCountStaleMs: sanitizePositiveInteger(body.player_count_stale_ms, 90_000, 30 * 60 * 1000),
    includeResults: true,
    queueDiscordUpdates: false,
    skipAutomationMaintenance: true,
    debugServiceId,
  };
  const responseTimeoutMs = Math.max(250, Math.min(refreshOptions.deadlineMs, 5_000));

  if (body.async === true) {
    waitUntil(runMetadataRefresh(env, source, startedAt, refreshOptions, handlers).catch((error) => {
      console.warn("DZN METADATA ASYNC CRON REFRESH FAILED", error instanceof Error ? error.message : "metadata refresh failed");
    }));
    return json({
      ok: true,
      accepted: true,
      source,
      cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
      max_servers: refreshOptions.maxServers,
      deadline_ms: refreshOptions.deadlineMs,
      player_count_stale_ms: refreshOptions.livePlayerCountStaleMs,
      debug_service_id: debugServiceId,
    }, { status: 202 });
  }

  const refreshPromise = runMetadataRefresh(env, source, startedAt, refreshOptions, handlers ?? await defaultHandlers());
  refreshPromise.catch((error) => {
    console.warn("DZN METADATA CRON REFRESH FINISHED AFTER RESPONSE", error instanceof Error ? error.message : "metadata refresh failed");
  });
  const { result, timedOut } = await raceMetadataRefreshWithTimeout(refreshPromise, responseTimeoutMs);
  const [staleRemainingCount, diagnostics] = await Promise.all([
    countStaleMetadataRemaining(env, refreshOptions.livePlayerCountStaleMs).catch(() => null),
    readMetadataDiagnostics(env, refreshOptions.livePlayerCountStaleMs).catch(() => null),
  ]);

  console.log("DZN LIVE PLAYER COUNT AUTO SYNC READY", {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
    updated_player_counts: result.updated_player_counts,
  });
  console.log("DZN METADATA SYNC INDEPENDENT OF ADM READY", {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skipped: result.skipped,
  });

  return json({
    ok: true,
    ...result,
    timed_out: timedOut,
    stale_remaining_count: staleRemainingCount,
    next_recommended_run_seconds: staleRemainingCount && staleRemainingCount > 0 ? 60 : 300,
    diagnostics: buildSafeMetadataDiagnostics(result, diagnostics, debugServiceId),
    warnings: buildMetadataWarnings(result, timedOut, staleRemainingCount),
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

async function raceMetadataRefreshWithTimeout(
  promise: Promise<MetadataRefreshResult>,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then((result) => ({ result, timedOut: false })),
      new Promise<{ result: MetadataRefreshResult; timedOut: true }>((resolve) => {
        timeout = setTimeout(() => {
          resolve({
            timedOut: true,
            result: {
              processed: 0,
              succeeded: 0,
              failed: 0,
              skipped: 0,
              updated_player_counts: 0,
              budget_exhausted: true,
              results: [],
            },
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runMetadataRefresh(
  env: Env,
  source: ReturnType<typeof normalizeAutomationCronSource>,
  startedAt: string,
  options: MetadataRefreshOptions,
  handlers?: MetadataSyncRunHandlers,
) {
  try {
    const activeHandlers = handlers ?? await defaultHandlers();
    const result = await activeHandlers.refreshMetadata(env, options);
    await safeRecordCronRun(env, source, result.failed > 0 && result.succeeded > 0 ? "partial" : result.failed > 0 ? "failed" : "success", startedAt, undefined, {
      processedCount: result.processed,
      skippedCount: result.skipped,
      failedCount: result.failed,
    });
    return result;
  } catch (error) {
    await safeRecordCronRun(env, source, "failed", startedAt, error);
    throw error;
  }
}

async function countStaleMetadataRemaining(env: Env, staleMs = 90_000) {
  const cutoff = new Date(Date.now() - Math.max(30_000, Math.min(staleMs, 30 * 60 * 1000))).toISOString();
  const db = await requireDbLazy(env);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM linked_servers
       JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(COALESCE(server_subscriptions.status, 'inactive')) IN ('active', 'trialing')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND (
           linked_servers.metadata_last_checked_at IS NULL
           OR linked_servers.metadata_last_checked_at <= ?
           OR linked_servers.player_count_last_checked_at IS NULL
           OR linked_servers.player_count_last_checked_at <= ?
         )`,
    )
    .bind(cutoff, cutoff)
    .first<{ count: number | null }>();
  return Number(row?.count ?? 0);
}

async function readMetadataDiagnostics(env: Env, staleMs = 90_000) {
  const cutoff = new Date(Date.now() - Math.max(30_000, Math.min(staleMs, 30 * 60 * 1000))).toISOString();
  const db = await requireDbLazy(env);
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS stale_remaining_count,
         MAX(CASE WHEN linked_servers.player_count_last_checked_at IS NOT NULL THEN
           (strftime('%s', 'now') - strftime('%s', linked_servers.player_count_last_checked_at))
         ELSE NULL END) AS oldest_public_metadata_age_seconds
       FROM linked_servers
       JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) IN ('public', 'listed')
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(COALESCE(server_subscriptions.status, 'inactive')) IN ('active', 'trialing')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND (
           linked_servers.metadata_last_checked_at IS NULL
           OR linked_servers.metadata_last_checked_at <= ?
           OR linked_servers.player_count_last_checked_at IS NULL
           OR linked_servers.player_count_last_checked_at <= ?
         )`,
    )
    .bind(cutoff, cutoff)
    .first<{ stale_remaining_count: number | null; oldest_public_metadata_age_seconds: number | null }>();

  const tracked = await db
    .prepare(
      `SELECT nitrado_service_id, display_name, current_players, max_players,
              player_count_status, player_count_last_checked_at
       FROM linked_servers
       WHERE nitrado_service_id IN ('18765761', '17428528')
       ORDER BY nitrado_service_id`,
    )
    .all<{
      nitrado_service_id: string | null;
      display_name: string | null;
      current_players: number | null;
      max_players: number | null;
      player_count_status: string | null;
      player_count_last_checked_at: string | null;
    }>();

  return {
    stale_remaining_count: Number(row?.stale_remaining_count ?? 0),
    oldest_public_metadata_age_seconds: row?.oldest_public_metadata_age_seconds === null || row?.oldest_public_metadata_age_seconds === undefined
      ? null
      : Number(row.oldest_public_metadata_age_seconds),
    tracked_public_servers: (tracked.results ?? []).map((server) => ({
      service_id: server.nitrado_service_id,
      server_name: server.display_name,
      current_players: server.current_players,
      max_players: server.max_players,
      player_count_status: server.player_count_status,
      player_count_last_checked_at: server.player_count_last_checked_at,
      age_seconds: ageSeconds(server.player_count_last_checked_at),
    })),
  };
}

function buildSafeMetadataDiagnostics(
  result: MetadataRefreshResult,
  diagnostics: Awaited<ReturnType<typeof readMetadataDiagnostics>> | null,
  debugServiceId: string | null,
) {
  return {
    debug_service_id: debugServiceId,
    selected_service_ids: result.results.map((item) => item.service_id).filter((value): value is string => typeof value === "string" && value.length > 0),
    skipped_service_ids: result.results
      .filter((item) => item.status === "skipped")
      .map((item) => ({
        service_id: item.service_id,
        reason: item.message,
      })),
    failed_service_ids: result.results
      .filter((item) => item.status === "failed")
      .map((item) => ({
        service_id: item.service_id,
        reason: item.message,
      })),
    stale_remaining_count: diagnostics?.stale_remaining_count ?? null,
    oldest_public_metadata_age_seconds: diagnostics?.oldest_public_metadata_age_seconds ?? null,
    tracked_public_servers: diagnostics?.tracked_public_servers ?? [],
  };
}

function buildMetadataWarnings(
  result: MetadataRefreshResult,
  timedOut: boolean,
  staleRemainingCount: number | null,
) {
  const warnings: string[] = [];
  if (timedOut || result.budget_exhausted) warnings.push("Metadata refresh reached its response/runtime budget; remaining servers will continue next run.");
  if (staleRemainingCount !== null && staleRemainingCount > 0) warnings.push(`${staleRemainingCount} stale metadata server${staleRemainingCount === 1 ? "" : "s"} remain queued for the next scheduler tick.`);
  const failed = result.results.filter((item) => item.status === "failed");
  if (failed.length > 0) warnings.push(`${failed.length} metadata refresh attempt${failed.length === 1 ? "" : "s"} failed; previous player counts remain protected by freshness rules.`);
  return warnings;
}

export function isMetadataCronAuthorized(request: Request, env: Env) {
  return isCronSecretAuthorized(request, env);
}

function sanitizePositiveInteger(value: unknown, fallback: number, max = 100000) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.trunc(number), max) : fallback;
}

function sanitizeServiceId(value: unknown) {
  return typeof value === "string" && /^\d{3,32}$/.test(value.trim()) ? value.trim() : null;
}

function ageSeconds(value: string | null | undefined) {
  const checkedAt = Date.parse(value ?? "");
  if (!Number.isFinite(checkedAt)) return null;
  return Math.max(0, Math.trunc((Date.now() - checkedAt) / 1000));
}

async function safeRecordCronRun(
  env: Env,
  source: ReturnType<typeof normalizeAutomationCronSource>,
  status: "success" | "failed" | "partial",
  startedAt: string,
  error?: unknown,
  metrics: { processedCount?: number; skippedCount?: number; failedCount?: number } = {},
) {
  const finishedAt = new Date().toISOString();
  try {
    const { recordAutomationCronRun } = await import("../../../_lib/automation");
    await recordAutomationCronRun(env, {
      source,
      jobType: "metadata",
      status,
      startedAt,
      finishedAt,
      errorMessage: error instanceof Error ? error.message : null,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      ...metrics,
    });
  } catch (error) {
    console.warn("DZN AUTOMATION CRON RUN RECORD SKIPPED", {
      endpoint: "metadata",
      message: error instanceof Error ? error.message : "record failed",
    });
  }
}

async function defaultHandlers(): Promise<MetadataSyncRunHandlers> {
  const { refreshLivePlayerCountsForActiveServers } = await import("../../../_lib/server-metadata");
  return {
    refreshMetadata: (env, options = {}) => refreshLivePlayerCountsForActiveServers(env, options),
  };
}

async function requireDbLazy(env: Env): Promise<D1Database> {
  const { requireDb } = await import("../../../_lib/db");
  return requireDb(env);
}

function normalizeAutomationCronSource(source: unknown, cron?: unknown) {
  const explicit = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (explicit === "cloudflare" || explicit === "github-backup" || explicit === "manual") return explicit;
  if (explicit.includes("cloudflare")) return "cloudflare";
  if (explicit.includes("github")) return "github-backup";
  const cronValue = typeof cron === "string" ? cron.trim().toLowerCase() : "";
  if (cronValue.includes("github")) return "github-backup";
  if (cronValue.includes("cloudflare") || cronValue === "* * * * *") return "cloudflare";
  return "manual";
}

async function readJson<T>(request: Request): Promise<T> {
  if (!request.body) return {} as T;
  try {
    return await request.json() as T;
  } catch {
    return {} as T;
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}
