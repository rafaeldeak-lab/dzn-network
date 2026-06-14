import {
  normalizeAutomationCronSource,
  recordAutomationCronRun,
  type AutomationCronJobType,
  type AutomationCronStatus,
} from "../functions/_lib/automation";
import type { Env } from "../functions/_lib/types";

type WorkerScheduledController = {
  cron?: string;
  scheduledTime?: number;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type SchedulerTask = {
  label: AutomationCronJobType;
  path: string;
  timeoutMs: number;
  body: Record<string, unknown>;
};

const WORKER_NAME = "dzn-auto-update-worker";
const DEFAULT_APP_URL = "https://dzn-network.pages.dev";
const CRON_SECRET_HEADERS = ["x-dzn-cron-secret", "x-sync-cron-secret", "x-cron-secret"] as const;

const TASKS: SchedulerTask[] = [
  {
    label: "metadata",
    path: "/api/sync/metadata/run",
    timeoutMs: 6_000,
    body: {
      source: "cloudflare-scheduled",
      cron: "dzn-auto-update-worker",
      async: true,
      max_servers: 2,
      deadline_ms: 20_000,
    },
  },
  {
    label: "server-wars",
    path: "/api/cron/server-wars/refresh",
    timeoutMs: 10_000,
    body: {
      source: "cloudflare-scheduled",
      async: true,
      max_events: 1,
      max_finalizations: 1,
      max_challenge_expirations: 10,
      deadline_ms: 2_500,
    },
  },
  {
    label: "discord-posts",
    path: "/api/sync/discord-posts/run",
    timeoutMs: 10_000,
    body: {
      source: "cloudflare-scheduled",
      cron: "dzn-auto-update-worker",
      async: true,
      max_jobs: 2,
      deadline_ms: 2_500,
    },
  },
];

export async function scheduled(
  event: WorkerScheduledController,
  env: Env,
  ctx: WorkerExecutionContext,
) {
  ctx.waitUntil(runAutoUpdateTick(env, {
    cron: event.cron ?? "*/5 * * * *",
    scheduledTime: event.scheduledTime ?? Date.now(),
  }));
}

export async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      ok: true,
      worker: WORKER_NAME,
      cron: "*/5 * * * *",
      tasks: TASKS.map((task) => task.label),
    });
  }

  if (request.method === "POST" && url.pathname === "/run-now") {
    if (!isHealthAuthorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    return json(await runAutoUpdateTick(env, {
      cron: "manual-auto-update-test",
      scheduledTime: Date.now(),
    }));
  }

  return json({ ok: false, error: "Not found" }, 404);
}

export async function runAutoUpdateTick(env: Env, options: { cron: string | null; scheduledTime: number }) {
  const secret = getCronSecret(env);
  if (!secret) {
    console.warn("DZN AUTO UPDATE WORKER SECRET MISSING", { worker: WORKER_NAME });
    return {
      ok: false,
      worker: WORKER_NAME,
      error: "DZN_CRON_SECRET is not configured for auto-update Worker.",
      results: TASKS.map((task) => ({
        label: task.label,
        ok: false,
        status: 0,
        skipped: true,
        message: "Cron secret is not configured.",
      })),
    };
  }

  const baseUrl = appBaseUrl(env);
  const results = [];
  for (const task of TASKS) {
    const startedAt = new Date().toISOString();
    const result = await runTask(task, baseUrl, secret, options);
    results.push(result);
    await safeRecordTask(env, task.label, result.ok ? "success" : "failed", startedAt, result).catch((error) => {
      console.warn("DZN AUTO UPDATE WORKER CRON RUN RECORD SKIPPED", {
        task: task.label,
        message: error instanceof Error ? sanitizeMessage(error.message) : "record failed",
      });
    });
  }

  const ok = results.some((result) => result.ok);
  console.log("DZN AUTO UPDATE WORKER TICK COMPLETE", {
    ok,
    tasks: results.map((result) => ({
      label: result.label,
      ok: result.ok,
      status: result.status,
      processed: result.processed,
      failed: result.failed,
    })),
  });
  return { ok, worker: WORKER_NAME, results };
}

async function runTask(
  task: SchedulerTask,
  baseUrl: string,
  secret: string,
  options: { cron: string | null; scheduledTime: number },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), task.timeoutMs);
  try {
    const headers = new Headers({
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    });
    for (const header of CRON_SECRET_HEADERS) headers.set(header, secret);

    const response = await globalThis.fetch(new URL(task.path, baseUrl).toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...task.body,
        scheduled_time: options.scheduledTime,
        cron: options.cron ?? "dzn-auto-update-worker",
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    return {
      label: task.label,
      ok: response.ok && body?.ok !== false,
      status: response.status,
      processed: numberMetric(body?.processed ?? body?.processedCount ?? body?.processed_count),
      skipped: numberMetric(body?.skipped ?? body?.skippedCount ?? body?.skipped_count),
      failed: numberMetric(body?.failed ?? body?.failedCount ?? body?.failed_count),
      body: sanitizeTaskBody(body),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.warn("DZN AUTO UPDATE WORKER TASK FAILED", {
      task: task.label,
      message: sanitizeMessage(message),
    });
    return {
      label: task.label,
      ok: false,
      status: 0,
      processed: 0,
      skipped: 0,
      failed: 1,
      body: { ok: false, error: sanitizeMessage(message) },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function safeRecordTask(
  env: Env,
  jobType: AutomationCronJobType,
  status: AutomationCronStatus,
  startedAt: string,
  result: { processed: number; skipped: number; failed: number; body: unknown },
) {
  const finishedAt = new Date().toISOString();
  await recordAutomationCronRun(env, {
    source: normalizeAutomationCronSource("cloudflare-scheduled", "dzn-auto-update-worker"),
    jobType,
    status,
    startedAt,
    finishedAt,
    errorMessage: status === "failed" ? errorMessageFromBody(result.body) : null,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    processedCount: result.processed,
    skippedCount: result.skipped,
    failedCount: result.failed,
  });
}

function appBaseUrl(env: Env) {
  const configured = env.DZN_APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return DEFAULT_APP_URL;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_APP_URL;
  }
}

function getCronSecret(env: Env) {
  return env.DZN_CRON_SECRET || env.SYNC_CRON_SECRET || null;
}

function isHealthAuthorized(request: Request, env: Env) {
  const expected = env.SYNC_WORKER_HEALTH_TOKEN;
  if (!expected) return true;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function numberMetric(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function sanitizeTaskBody(value: Record<string, unknown> | null) {
  if (!value) return null;
  return {
    ok: value.ok,
    accepted: value.accepted,
    processed: value.processed ?? value.processedCount ?? value.processed_count,
    succeeded: value.succeeded,
    skipped: value.skipped ?? value.skippedCount ?? value.skipped_count,
    failed: value.failed ?? value.failedCount ?? value.failed_count,
    updated_player_counts: value.updated_player_counts,
    timed_out: value.timed_out,
    budget_exhausted: value.budget_exhausted ?? value.budgetExhausted,
    snapshots: Array.isArray(value.snapshots) ? value.snapshots.length : undefined,
    finalized: Array.isArray(value.finalized) ? value.finalized.length : undefined,
    expiredChallenges: isRecord(value.transitions) ? value.transitions.expiredChallenges : undefined,
    error: sanitizeMessage(value.error),
    message: sanitizeMessage(value.message),
  };
}

function errorMessageFromBody(value: unknown) {
  if (!isRecord(value)) return null;
  return sanitizeMessage(value.error ?? value.message);
}

function sanitizeMessage(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(token|access_token|signature|sig|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

const worker = {
  scheduled,
  fetch,
};

export default worker;
