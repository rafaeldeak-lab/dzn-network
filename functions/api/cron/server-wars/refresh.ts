import { requireCronSecret } from "../../../_lib/cron-auth";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import {
  runServerWarAutomationTick,
  SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS,
  SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT,
  SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT,
} from "../../../_lib/server-war-automation";
import type { Env, PagesFunction } from "../../../_lib/types";

type ServerWarCronBody = {
  async?: unknown;
  maxEvents?: unknown;
  max_events?: unknown;
  maxFinalizations?: unknown;
  max_finalizations?: unknown;
  maxChallengeExpirations?: unknown;
  max_challenge_expirations?: unknown;
  deadlineMs?: unknown;
  deadline_ms?: unknown;
  source?: unknown;
};

type ServerWarCronOptions = {
  maxEvents: number;
  maxFinalizations: number;
  maxChallengeExpirations: number;
  deadlineMs: number;
  source: string;
};

type ServerWarCronTaskStatus = "success" | "no_op" | "warning" | "failed";

export const onRequestPost: PagesFunction = async ({ request, env, waitUntil }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  try {
    const body = await readJson<ServerWarCronBody>(request);
    const startedAt = new Date().toISOString();
    const source = typeof body.source === "string" ? body.source : "cron";
    const options = {
      maxEvents: numberParam(body.maxEvents ?? body.max_events, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT),
      maxFinalizations: numberParam(body.maxFinalizations ?? body.max_finalizations, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT),
      maxChallengeExpirations: numberParam(body.maxChallengeExpirations ?? body.max_challenge_expirations, 10, 20),
      deadlineMs: numberParam(body.deadlineMs ?? body.deadline_ms, SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS, 5_000),
      source,
    } satisfies ServerWarCronOptions;
    if (body.async === true) {
      waitUntil(runAndRecordServerWarAutomation(env, startedAt, options).catch((error) => {
        console.warn("DZN async cron Server Wars refresh failed", error instanceof Error ? error.message : "unknown");
      }));
      return json({
        ok: true,
        accepted: true,
        taskStatus: "accepted",
        task_status: "accepted",
        source,
        max_events: options.maxEvents,
        max_finalizations: options.maxFinalizations,
        max_challenge_expirations: options.maxChallengeExpirations,
        deadline_ms: options.deadlineMs,
      }, { status: 202, headers: { "cache-control": "no-store" } });
    }

    const result = await runAndRecordServerWarAutomation(env, startedAt, options);
    return json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN cron Server Wars refresh failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({
      ok: false,
      taskStatus: "failed",
      task_status: "failed",
      processed: 0,
      skipped: 0,
      failed: 1,
      error: "SERVER_WARS_AUTOMATION_UNAVAILABLE",
      errorCode: "SERVER_WARS_AUTOMATION_UNAVAILABLE",
      message: "Server Wars automation is temporarily unavailable.",
      requestId,
    }, { status: 500, headers: { "cache-control": "no-store" } });
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

function numberParam(value: unknown, fallback: number, max: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
}

async function runAndRecordServerWarAutomation(
  env: Env,
  startedAt: string,
  options: ServerWarCronOptions,
) {
  try {
    const result = await runServerWarAutomationTick(env, options);
    const contract = toServerWarCronContract(result);
    await recordAutomationCronRun(env, {
      source: normalizeAutomationCronSource(options.source, options.source),
      jobType: "server-wars",
      status: contract.taskStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: contract.error ?? contract.warning ?? contract.noOpReason,
      processedCount: contract.processed,
      skippedCount: contract.skipped,
      failedCount: contract.failed,
    }).catch((error) => {
      console.warn("DZN Server Wars cron run record skipped", {
        message: error instanceof Error ? error.message : "record failed",
      });
    });
    return contract;
  } catch (error) {
    const message = sanitizeServerWarCronMessage(error);
    await recordAutomationCronRun(env, {
      source: normalizeAutomationCronSource(options.source, options.source),
      jobType: "server-wars",
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: message,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    }).catch((recordError) => {
      console.warn("DZN Server Wars cron failure record skipped", {
        message: recordError instanceof Error ? recordError.message : "record failed",
      });
    });
    return {
      ok: false,
      taskStatus: "failed" as const,
      task_status: "failed" as const,
      processed: 0,
      skipped: 0,
      failed: 1,
      snapshots: 0,
      finalized: 0,
      expiredChallenges: 0,
      budgetExhausted: false,
      budget_exhausted: false,
      noOpReason: null,
      no_op_reason: null,
      warningCode: null,
      warning: null,
      errorCode: "server_wars_automation_failed",
      error: message,
    };
  }
}

function toServerWarCronContract(result: Awaited<ReturnType<typeof runServerWarAutomationTick>>) {
  const snapshots = result.snapshots.length;
  const finalized = result.finalized.length;
  const expiredChallenges = result.transitions.expiredChallenges;
  const processed = snapshots + finalized + expiredChallenges + result.transitions.scheduledToLive + result.transitions.liveToFinalizing;
  const failed = [...result.snapshots, ...result.finalized].filter((item) => !item.ok).length;
  const warning = result.warnings[0] ?? null;
  const taskStatus: ServerWarCronTaskStatus = failed > 0
    ? "failed"
    : warning || result.budgetExhausted
      ? "warning"
      : processed === 0
        ? "no_op"
        : "success";
  const noOpReason = taskStatus === "no_op" ? "no_due_server_war_work" : null;
  const warningCode = taskStatus === "warning"
    ? result.budgetExhausted ? "server_wars_budget_exhausted" : "server_wars_warning"
    : null;
  const errorCode = taskStatus === "failed" ? "server_wars_item_failed" : null;
  const error = taskStatus === "failed"
    ? [...result.snapshots, ...result.finalized].find((item) => !item.ok)?.error ?? "Server Wars automation item failed"
    : null;
  return {
    ok: taskStatus !== "failed",
    taskStatus,
    task_status: taskStatus,
    noOpReason,
    no_op_reason: noOpReason,
    processed,
    skipped: result.budgetExhausted ? 1 : 0,
    failed: taskStatus === "failed" ? Math.max(1, failed) : 0,
    snapshots,
    finalized,
    expiredChallenges,
    budgetExhausted: result.budgetExhausted,
    budget_exhausted: result.budgetExhausted,
    warningCode,
    warning,
    errorCode,
    error,
    transitions: result.transitions,
    source: result.source,
    now: result.now,
  };
}

function sanitizeServerWarCronMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error ?? "Server Wars automation failed")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(token|access_token|signature|sig|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}
