import { dispatchQueuedDiscordPostUpdates } from "../../../_lib/discord-posting";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type DiscordPostRunBody = {
  async?: boolean;
  max_jobs?: number;
  deadline_ms?: number;
  cron?: string;
  source?: string;
};

type DiscordPostRunHandlers = {
  dispatch: typeof dispatchQueuedDiscordPostUpdates;
};

const DEFAULT_HANDLERS: DiscordPostRunHandlers = {
  dispatch: dispatchQueuedDiscordPostUpdates,
};

export const onRequestPost: PagesFunction = (context) => handleDiscordPostRun(context);

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

export const onRequestGet: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["POST"] },
  { status: 405, headers: { Allow: "POST" } },
);

export async function handleDiscordPostRun(
  { request, env, waitUntil }: PagesContext,
  handlers: DiscordPostRunHandlers = DEFAULT_HANDLERS,
) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const body = await readJson<DiscordPostRunBody>(request);
  const source = normalizeAutomationCronSource(body.source, body.cron);
  const startedAt = new Date().toISOString();
  const runOptions = {
    maxJobs: sanitizePositiveInteger(body.max_jobs, 2, 10),
    deadlineMs: sanitizePositiveInteger(body.deadline_ms, 2500, 5000),
  };

  if (body.async === true) {
    waitUntil(runDiscordPostDispatch(env, source, startedAt, runOptions, handlers).catch((error) => {
      console.warn("DZN DISCORD POST ASYNC CRON RUN FAILED", error instanceof Error ? error.message : "discord post sync failed");
    }));
    return json({
      ok: true,
      accepted: true,
      source,
      cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
      max_jobs: runOptions.maxJobs,
      deadline_ms: runOptions.deadlineMs,
    }, { status: 202 });
  }

  const result = await runDiscordPostDispatch(env, source, startedAt, runOptions, handlers);
  return json({
    ...result,
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

async function runDiscordPostDispatch(
  env: Env,
  source: ReturnType<typeof normalizeAutomationCronSource>,
  startedAt: string,
  options: { maxJobs: number; deadlineMs: number },
  handlers: DiscordPostRunHandlers,
) {
  try {
    const result = await handlers.dispatch(env, options);
    await safeRecordCronRun(env, source, result.failed > 0 && (result.posted > 0 || result.skipped > 0) ? "partial" : result.failed > 0 ? "failed" : "success", startedAt, undefined, {
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

export function isDiscordPostCronAuthorized(request: Request, env: Env) {
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
      jobType: "discord-posts",
      status,
      startedAt,
      finishedAt,
      errorMessage: error instanceof Error ? error.message : null,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      ...metrics,
    });
  } catch (error) {
    console.warn("DZN AUTOMATION CRON RUN RECORD SKIPPED", {
      endpoint: "discord-posts",
      message: error instanceof Error ? error.message : "record failed",
    });
  }
}
