import { dispatchQueuedDiscordPostUpdates } from "../../../_lib/discord-posting";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type DiscordPostRunBody = {
  max_jobs?: number;
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
  { request, env }: PagesContext,
  handlers: DiscordPostRunHandlers = DEFAULT_HANDLERS,
) {
  const body = await readJson<DiscordPostRunBody>(request);
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const source = normalizeAutomationCronSource(body.source, body.cron);
  const startedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof dispatchQueuedDiscordPostUpdates>>;
  try {
    result = await handlers.dispatch(env, {
      maxJobs: sanitizePositiveInteger(body.max_jobs, 25),
    });
    await safeRecordCronRun(env, source, result.failed > 0 && (result.posted > 0 || result.skipped > 0) ? "partial" : result.failed > 0 ? "failed" : "success", startedAt, undefined, {
      processedCount: result.processed,
      skippedCount: result.skipped,
      failedCount: result.failed,
    });
  } catch (error) {
    await safeRecordCronRun(env, source, "failed", startedAt, error);
    throw error;
  }
  return json({
    ...result,
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
  });
}

export function isDiscordPostCronAuthorized(request: Request, env: Env) {
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
