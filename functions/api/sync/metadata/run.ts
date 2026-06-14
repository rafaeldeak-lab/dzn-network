import { refreshLivePlayerCountsForActiveServers } from "../../../_lib/server-metadata";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";
import { requireDb } from "../../../_lib/db";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type MetadataSyncRunBody = {
  async?: boolean;
  cron?: string;
  deadline_ms?: number;
  player_count_stale_ms?: number;
  source?: string;
  max_servers?: number;
};

type MetadataSyncRunHandlers = {
  refreshMetadata: typeof refreshLivePlayerCountsForActiveServers;
};

const DEFAULT_HANDLERS: MetadataSyncRunHandlers = {
  refreshMetadata: refreshLivePlayerCountsForActiveServers,
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
  handlers: MetadataSyncRunHandlers = DEFAULT_HANDLERS,
) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const body = await readJson<MetadataSyncRunBody>(request);

  const source = normalizeAutomationCronSource(body.source, body.cron);
  const startedAt = new Date().toISOString();
  const refreshOptions = {
    maxServers: sanitizePositiveInteger(body.max_servers, 1, 5),
    deadlineMs: sanitizePositiveInteger(body.deadline_ms, 20_000, 60_000),
    livePlayerCountStaleMs: sanitizePositiveInteger(body.player_count_stale_ms, 90_000, 30 * 60 * 1000),
    includeResults: true,
    queueDiscordUpdates: false,
    skipAutomationMaintenance: true,
  };
  const responseTimeoutMs = Math.max(250, Math.min(refreshOptions.deadlineMs, 12_000));

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
    }, { status: 202 });
  }

  const refreshPromise = runMetadataRefresh(env, source, startedAt, refreshOptions, handlers);
  refreshPromise.catch((error) => {
    console.warn("DZN METADATA CRON REFRESH FINISHED AFTER RESPONSE", error instanceof Error ? error.message : "metadata refresh failed");
  });
  const { result, timedOut } = await raceMetadataRefreshWithTimeout(refreshPromise, responseTimeoutMs);
  const staleRemainingCount = await countStaleMetadataRemaining(env).catch(() => null);

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
    warnings: buildMetadataWarnings(result, timedOut, staleRemainingCount),
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

async function raceMetadataRefreshWithTimeout(
  promise: Promise<Awaited<ReturnType<typeof refreshLivePlayerCountsForActiveServers>>>,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then((result) => ({ result, timedOut: false })),
      new Promise<{ result: Awaited<ReturnType<typeof refreshLivePlayerCountsForActiveServers>>; timedOut: true }>((resolve) => {
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
  options: Parameters<typeof refreshLivePlayerCountsForActiveServers>[1],
  handlers: MetadataSyncRunHandlers,
) {
  try {
    const result = await handlers.refreshMetadata(env, options);
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

async function countStaleMetadataRemaining(env: Env) {
  const cutoff = new Date(Date.now() - 90 * 1000).toISOString();
  const row = await requireDb(env)
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

function buildMetadataWarnings(
  result: Awaited<ReturnType<typeof refreshLivePlayerCountsForActiveServers>>,
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
