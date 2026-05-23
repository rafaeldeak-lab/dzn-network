import type { Env } from "../functions/_lib/types";
import { runAdmWorkerSyncTick } from "../functions/_lib/adm-sync";
import {
  normalizeAutomationCronSource,
  recordAutomationCronRun,
  recoverStuckAutomationLocks,
} from "../functions/_lib/automation";
import { requireDb } from "../functions/_lib/db";

type WorkerScheduledController = {
  cron?: string;
  scheduledTime?: number;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type CronEndpoint = {
  label: "discord-posts";
  path: string;
  body: Record<string, unknown>;
};

const WORKER_NAME = "dzn-adm-sync-worker";
const DZN_CRON_SECRET_HEADER = "x-dzn-cron-secret";
const DEFAULT_APP_URL = "https://dzn-network.pages.dev";
const CRON_ENDPOINT_TIMEOUT_MS = 55000;
const ADM_WORKER_CURSOR_KEY = "last_adm_linked_server_id";
const ADM_WORKER_LAST_RECOVERY_KEY = "last_automation_lock_recovery_at";

const CRON_ENDPOINTS: CronEndpoint[] = [
  {
    label: "discord-posts",
    path: "/api/sync/discord-posts/run",
    body: { source: "cloudflare", cron: "cloudflare-worker", max_jobs: 50 },
  },
];

export async function scheduled(
  event: WorkerScheduledController,
  env: Env,
  ctx: WorkerExecutionContext,
) {
  ctx.waitUntil(runAutomationCron(env, {
    cron: event.cron ?? null,
    scheduledTime: event.scheduledTime ?? Date.now(),
  }));
}

export async function fetch(request: Request, env: Env, _ctx?: WorkerExecutionContext): Promise<Response> {
  void _ctx;
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    if (!isHealthAuthorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    return json({ ok: true, worker: WORKER_NAME, cron: "* * * * *" });
  }

  if (request.method === "POST" && url.pathname === "/run-now") {
    if (!isHealthAuthorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    return json(await runAutomationCron(env, { cron: "manual-worker-test", scheduledTime: Date.now() }));
  }

  return json({ ok: false, error: "Not found" }, 404);
}

export async function runAutomationCron(env: Env, options: { cron: string | null; scheduledTime: number }) {
  const secret = getCronSecret(env);
  if (!secret) {
    console.warn("DZN AUTOMATION CRON SECRET MISSING");
    return { ok: false, error: "DZN_CRON_SECRET is not configured", results: [] };
  }

  const baseUrl = appBaseUrl(env);
  const results = [];
  results.push(await runDirectAdmSync(env, options));
  await runHourlyPostAdmMaintenance(env).catch((error) => {
    console.warn("DZN ADM WORKER POST-READ MAINTENANCE SKIPPED", {
      message: error instanceof Error ? error.message : "Unknown maintenance error",
    });
  });
  results.push(await runCronEndpoint(CRON_ENDPOINTS[0], baseUrl, secret, options));

  console.log("DZN CLOUDFLARE WORKER CRON TICK COMPLETE", {
    ok: results.every((result) => result.ok),
    endpoints: results.map((result) => ({ label: result.label, status: result.status, ok: result.ok })),
  });
  return { ok: results.every((result) => result.ok), results };
}

async function runDirectAdmSync(env: Env, options: { cron: string | null; scheduledTime: number }) {
  const source = normalizeAutomationCronSource("cloudflare", options.cron ?? "cloudflare-worker");
  const startedAt = new Date().toISOString();
  try {
    const result = await runAdmWorkerSyncTick(env, {
      cron: options.cron ?? "cloudflare-worker",
      maxLinesPerServer: 15000,
      cursorKey: ADM_WORKER_CURSOR_KEY,
    });
    await safeRecordWorkerCronRun(env, result.failed > 0 && result.succeeded > 0 ? "partial" : result.failed > 0 ? "failed" : "success", startedAt, undefined, {
      processedCount: result.processing_processed_count,
      skippedCount: result.skipped + result.skipped_not_due + result.skipped_locked + result.skipped_unreadable,
      failedCount: result.failed,
    });
    return {
      label: "adm" as const,
      status: 200,
      ok: result.failed === 0,
      body: {
        ...result,
        source,
        worker_direct: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADM Worker sync failed";
    await safeRecordWorkerCronRun(env, "failed", startedAt, error);
    console.warn("DZN ADM WORKER DIRECT SYNC FAILED", {
      message,
    });
    return {
      label: "adm" as const,
      status: 500,
      ok: false,
      body: {
        ok: false,
        source,
        worker_direct: true,
        error: message,
      },
    };
  }
}

async function runHourlyPostAdmMaintenance(env: Env) {
  const db = requireDb(env);
  const row = await db
    .prepare("SELECT value FROM adm_worker_state WHERE key = ? LIMIT 1")
    .bind(ADM_WORKER_LAST_RECOVERY_KEY)
    .first<{ value: string | null }>();
  const lastRunAt = row?.value ? Date.parse(row.value) : 0;
  if (Number.isFinite(lastRunAt) && Date.now() - lastRunAt < 60 * 60 * 1000) return;

  await recoverStuckAutomationLocks(env);
  await db
    .prepare(
      `INSERT INTO adm_worker_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(ADM_WORKER_LAST_RECOVERY_KEY, new Date().toISOString(), new Date().toISOString())
    .run();
}

async function safeRecordWorkerCronRun(
  env: Env,
  status: "started" | "success" | "failed" | "partial",
  startedAt: string,
  error?: unknown,
  metrics: { processedCount?: number; skippedCount?: number; failedCount?: number } = {},
) {
  const finishedAt = new Date().toISOString();
  try {
    await recordAutomationCronRun(env, {
      source: "cloudflare",
      jobType: "adm",
      status,
      startedAt,
      finishedAt,
      errorMessage: error instanceof Error ? error.message : null,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      ...metrics,
    });
  } catch (recordError) {
    console.warn("DZN ADM WORKER CRON RUN RECORD SKIPPED", {
      message: recordError instanceof Error ? recordError.message : "record failed",
    });
  }
}

async function runCronEndpoint(
  endpoint: CronEndpoint,
  baseUrl: string,
  secret: string,
  options: { cron: string | null; scheduledTime: number },
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRON_ENDPOINT_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(new URL(endpoint.path, baseUrl).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DZN_CRON_SECRET_HEADER]: secret,
      },
      body: JSON.stringify({
        ...endpoint.body,
        source: "cloudflare",
        cron: options.cron ?? "cloudflare-worker",
        scheduled_time: options.scheduledTime,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    const result = {
      label: endpoint.label,
      status: response.status,
      ok: response.ok,
      body,
    };
    if (!response.ok) {
      console.warn("DZN AUTOMATION CRON ENDPOINT FAILED", {
        endpoint: endpoint.label,
        status: response.status,
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.warn("DZN AUTOMATION CRON ENDPOINT FAILED", {
      endpoint: endpoint.label,
      status: "request_failed",
      message,
    });
    return {
      label: endpoint.label,
      status: 0,
      ok: false,
      body: { ok: false, error: message },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function appBaseUrl(env: Env) {
  const configured = env.DZN_APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return DEFAULT_APP_URL;
  try {
    const url = new URL(configured);
    return url.origin;
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
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${expected}`;
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

const admSyncWorker = {
  scheduled,
  fetch,
};

export default admSyncWorker;
