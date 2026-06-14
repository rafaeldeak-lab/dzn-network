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
  const result = await runServerWarAutomationTick(env, options);
  await recordAutomationCronRun(env, {
    source: normalizeAutomationCronSource(options.source, options.source),
    jobType: "server-wars",
    status: result.warnings.length && result.snapshots.length + result.finalized.length === 0 ? "partial" : "success",
    startedAt,
    finishedAt: new Date().toISOString(),
    processedCount: result.snapshots.length + result.finalized.length + result.transitions.expiredChallenges + result.transitions.scheduledToLive + result.transitions.liveToFinalizing,
    skippedCount: result.budgetExhausted ? 1 : 0,
    failedCount: [...result.snapshots, ...result.finalized].filter((item) => !item.ok).length,
  }).catch((error) => {
    console.warn("DZN Server Wars cron run record skipped", {
      message: error instanceof Error ? error.message : "record failed",
    });
  });
  return result;
}
