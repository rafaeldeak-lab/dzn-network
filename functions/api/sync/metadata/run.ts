import { refreshLivePlayerCountsForActiveServers } from "../../../_lib/server-metadata";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type MetadataSyncRunBody = {
  cron?: string;
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
  { request, env }: PagesContext,
  handlers: MetadataSyncRunHandlers = DEFAULT_HANDLERS,
) {
  const body = await readJson<MetadataSyncRunBody>(request);
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const source = normalizeAutomationCronSource(body.source, body.cron);
  const startedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof refreshLivePlayerCountsForActiveServers>>;
  try {
    result = await handlers.refreshMetadata(env, {
      maxServers: sanitizePositiveInteger(body.max_servers, 25),
      includeResults: true,
    });
    await safeRecordCronRun(env, source, result.failed > 0 && result.succeeded > 0 ? "partial" : result.failed > 0 ? "failed" : "success", startedAt, undefined, {
      processedCount: result.processed,
      skippedCount: result.skipped,
      failedCount: result.failed,
    });
  } catch (error) {
    await safeRecordCronRun(env, source, "failed", startedAt, error);
    throw error;
  }

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
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

export function isMetadataCronAuthorized(request: Request, env: Env) {
  return isCronSecretAuthorized(request, env);
}

function sanitizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.trunc(number), 100000) : fallback;
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
