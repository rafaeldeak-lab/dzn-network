import { dispatchQueuedDiscordPostUpdates } from "../../../_lib/discord-posting";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";
import { json, readJson } from "../../../_lib/http";
import type { Env, PagesContext, PagesFunction } from "../../../_lib/types";

type DiscordPostRunBody = {
  async?: boolean;
  max_jobs?: number;
  max_posts?: number;
  deadline_ms?: number;
  mode?: string;
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
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  const body = await readJson<DiscordPostRunBody>(request);
  const source = normalizeAutomationCronSource(body.source, body.cron);
  const startedAt = new Date().toISOString();
  const runOptions = {
    maxJobs: sanitizePositiveInteger(body.max_posts ?? body.max_jobs, 1, 10),
    deadlineMs: sanitizePositiveInteger(body.deadline_ms, 2500, 5000),
  };

  const result = await runDiscordPostDispatch(env, source, startedAt, runOptions, handlers);
  return json({
    ...result,
    ok: result.task_status !== "failed" && result.task_status !== "timed_out",
    no_op_reason: result.task_status === "no_op" ? result.error : null,
    source,
    cron: typeof body.cron === "string" && body.cron.trim() ? body.cron.trim().slice(0, 80) : null,
    mode: typeof body.mode === "string" && body.mode.trim() ? body.mode.trim().slice(0, 80) : "single_bounded",
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
    const taskStatus = classifyDiscordResult(result);
    const taskError = discordResultMessage(result, taskStatus);
    await safeRecordCronRun(env, source, taskStatus, startedAt, taskError, {
      processedCount: result.processed,
      skippedCount: result.skipped,
      failedCount: result.failed,
    });
    return {
      ...result,
      task_status: taskStatus,
      error: taskError,
    };
  } catch (error) {
    await safeRecordCronRun(env, source, "failed", startedAt, error);
    throw error;
  }
}

function classifyDiscordResult(result: Awaited<ReturnType<DiscordPostRunHandlers["dispatch"]>>) {
  if (result.budgetExhausted && result.processed === 0) return "timed_out" as const;
  if (result.processed === 0 && result.skipped === 0 && result.failed === 0) return "no_op" as const;
  if (result.failed > 0 && (result.posted > 0 || result.skipped > 0)) return "partial" as const;
  if (result.failed > 0) return "failed" as const;
  return "success" as const;
}

function discordResultMessage(result: Awaited<ReturnType<DiscordPostRunHandlers["dispatch"]>>, status: ReturnType<typeof classifyDiscordResult>) {
  if (status === "success") return undefined;
  if (status === "no_op") return "discord_no_due_post";
  if (status === "timed_out") return "discord_budget_exhausted_before_work";
  const failed = result.results?.find((item) => item.status === "failed") ?? result.results?.[0];
  return failed?.reason || `discord_${status}`;
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
  status: "success" | "failed" | "partial" | "warning" | "no_op" | "timed_out" | "accepted",
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
      errorMessage: error instanceof Error ? error.message : typeof error === "string" ? error : null,
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
