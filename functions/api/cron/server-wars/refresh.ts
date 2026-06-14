import { requireCronSecret } from "../../../_lib/cron-auth";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import {
  runServerWarAutomationTick,
  SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS,
  SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT,
  SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT,
} from "../../../_lib/server-war-automation";
import type { PagesFunction } from "../../../_lib/types";

type ServerWarCronBody = {
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

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  try {
    const body = await readJson<ServerWarCronBody>(request);
    const startedAt = new Date().toISOString();
    const source = typeof body.source === "string" ? body.source : "cron";
    const result = await runServerWarAutomationTick(env, {
      maxEvents: numberParam(body.maxEvents ?? body.max_events, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT),
      maxFinalizations: numberParam(body.maxFinalizations ?? body.max_finalizations, SERVER_WAR_AUTOMATION_DEFAULT_EVENT_LIMIT, SERVER_WAR_AUTOMATION_MAX_EVENT_LIMIT),
      maxChallengeExpirations: numberParam(body.maxChallengeExpirations ?? body.max_challenge_expirations, 10, 20),
      deadlineMs: numberParam(body.deadlineMs ?? body.deadline_ms, SERVER_WAR_AUTOMATION_DEFAULT_DEADLINE_MS, 5_000),
      source,
    });
    await recordAutomationCronRun(env, {
      source: normalizeAutomationCronSource(source, source),
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
