import type { Env } from "../functions/_lib/types";
import { processRecentAdmBuildReparse, runAdmWorkerSyncTick } from "../functions/_lib/adm-sync";
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

type AdmWorkerHeartbeatFinish = {
  status: "success" | "recoverable" | "partial_budget_reached" | "fatal_error";
  errorCode?: string | null;
  errorMessage?: string | null;
  selectedServiceId?: string | null;
  selectedServerId?: string | null;
  action: string;
  recoverable: boolean;
};

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
  await safeWriteAdmWorkerHeartbeatStarted(env).catch(() => null);
  const secret = getCronSecret(env);
  if (!secret) {
    console.warn("DZN AUTOMATION CRON SECRET MISSING");
    await safeWriteAdmWorkerHeartbeatFinished(env, {
      status: "fatal_error",
      errorCode: "DZN_CRON_SECRET_MISSING",
      errorMessage: "DZN cron secret is not configured for ADM Worker tick.",
      action: "scheduled_tick_secret_missing",
      recoverable: false,
    }).catch(() => null);
    return { ok: false, error: "DZN_CRON_SECRET is not configured", results: [] };
  }

  try {
    const baseUrl = appBaseUrl(env);
    const results = [];
    results.push(await runDirectAdmSync(env, options));
    await runHourlyPostAdmMaintenance(env).catch((error) => {
      console.warn("DZN ADM WORKER POST-READ MAINTENANCE SKIPPED", {
        message: error instanceof Error ? sanitizeHeartbeatMessage(error.message) : "Unknown maintenance error",
      });
    });
    results.push(await runCronEndpoint(CRON_ENDPOINTS[0], baseUrl, secret, options));

    const heartbeat = classifyHeartbeatFromResults(results);
    await safeWriteAdmWorkerHeartbeatFinished(env, heartbeat).catch(() => null);

    console.log("DZN CLOUDFLARE WORKER CRON TICK COMPLETE", {
      ok: results.every((result) => result.ok),
      endpoints: results.map((result) => ({ label: result.label, status: result.status, ok: result.ok })),
      heartbeatStatus: heartbeat.status,
      heartbeatErrorCode: heartbeat.errorCode ?? null,
    });
    return { ok: results.every((result) => result.ok), results };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADM Worker tick failed";
    await safeWriteAdmWorkerHeartbeatFinished(env, {
      status: "fatal_error",
      errorCode: "ADM_WORKER_TICK_FAILED",
      errorMessage: message,
      action: "scheduled_tick_failed",
      recoverable: false,
    }).catch(() => null);
    throw error;
  }
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

async function safeWriteAdmWorkerHeartbeatStarted(env: Env) {
  const now = new Date().toISOString();
  try {
    await requireDb(env)
      .prepare(
        `INSERT INTO adm_worker_heartbeat (
           id, worker_name, last_started_at, last_status, last_action, last_recoverable, run_count, updated_at
         )
         VALUES (?, ?, ?, 'running', 'scheduled_tick_started', 0, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           worker_name = excluded.worker_name,
           last_started_at = excluded.last_started_at,
           last_status = excluded.last_status,
           last_error_code = NULL,
           last_error_message = NULL,
           last_selected_service_id = NULL,
           last_selected_server_id = NULL,
           last_action = excluded.last_action,
           last_recoverable = 0,
           run_count = COALESCE(adm_worker_heartbeat.run_count, 0) + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(WORKER_NAME, WORKER_NAME, now, now)
      .run();
  } catch (error) {
    console.warn("DZN ADM WORKER HEARTBEAT START SKIPPED", {
      message: error instanceof Error ? sanitizeHeartbeatMessage(error.message) : "heartbeat start failed",
    });
  }
}

async function safeWriteAdmWorkerHeartbeatFinished(env: Env, heartbeat: AdmWorkerHeartbeatFinish) {
  const now = new Date().toISOString();
  try {
    await requireDb(env)
      .prepare(
        `INSERT INTO adm_worker_heartbeat (
           id, worker_name, last_finished_at, last_status, last_error_code, last_error_message,
           last_selected_service_id, last_selected_server_id, last_action, last_recoverable,
           run_count, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(id) DO UPDATE SET
           worker_name = excluded.worker_name,
           last_finished_at = excluded.last_finished_at,
           last_status = excluded.last_status,
           last_error_code = excluded.last_error_code,
           last_error_message = excluded.last_error_message,
           last_selected_service_id = excluded.last_selected_service_id,
           last_selected_server_id = excluded.last_selected_server_id,
           last_action = excluded.last_action,
           last_recoverable = excluded.last_recoverable,
           updated_at = excluded.updated_at`,
      )
      .bind(
        WORKER_NAME,
        WORKER_NAME,
        now,
        heartbeat.status,
        heartbeat.errorCode ?? null,
        sanitizeHeartbeatMessage(heartbeat.errorMessage),
        heartbeat.selectedServiceId ?? null,
        heartbeat.selectedServerId ?? null,
        heartbeat.action,
        heartbeat.recoverable ? 1 : 0,
        now,
      )
      .run();
  } catch (error) {
    console.warn("DZN ADM WORKER HEARTBEAT FINISH SKIPPED", {
      message: error instanceof Error ? sanitizeHeartbeatMessage(error.message) : "heartbeat finish failed",
    });
  }
}

function classifyHeartbeatFromResults(results: Array<{ label: string; status: number; ok: boolean; body: unknown }>): AdmWorkerHeartbeatFinish {
  const adm = results.find((result) => result.label === "adm") ?? null;
  const body = isRecord(adm?.body) ? adm.body : {};
  const message = sanitizeHeartbeatMessage(body.message ?? body.error ?? null);
  const selectedServerId = typeof body.selected_linked_server_id === "string" ? body.selected_linked_server_id : null;
  const selectedServiceId = typeof body.selected_service_id === "string" ? body.selected_service_id : null;
  const errorCode = classifyHeartbeatErrorCode(body, message);
  const recoverable = isRecoverableHeartbeatError(errorCode)
    || Number(body.unavailable ?? 0) > 0
    || Number(body.latest_adm_unreadable_count ?? 0) > 0
    || Number(body.skipped_unreadable ?? 0) > 0;

  if (!adm || adm.status >= 500 || (adm.ok === false && !recoverable)) {
    return {
      status: "fatal_error",
      errorCode: errorCode ?? "ADM_WORKER_TICK_FAILED",
      errorMessage: message || "ADM Worker tick failed before completing automatic sync.",
      selectedServerId,
      selectedServiceId,
      action: "scheduled_tick_failed",
      recoverable: false,
    };
  }

  if (errorCode === "WORKER_SUBREQUEST_LIMIT") {
    return {
      status: "partial_budget_reached",
      errorCode,
      errorMessage: message || "Cloudflare Worker budget was reached; DZN will continue on the next tick.",
      selectedServerId,
      selectedServiceId,
      action: "scheduled_tick_partial_budget",
      recoverable: true,
    };
  }

  if (recoverable) {
    return {
      status: "recoverable",
      errorCode: errorCode ?? "latest_adm_unreadable",
      errorMessage: message || "ADM Worker tick completed with a recoverable ADM read state.",
      selectedServerId,
      selectedServiceId,
      action: "scheduled_tick_recoverable",
      recoverable: true,
    };
  }

  return {
    status: "success",
    errorCode: null,
    errorMessage: null,
    selectedServerId,
    selectedServiceId,
    action: "scheduled_tick_finished",
    recoverable: false,
  };
}

function classifyHeartbeatErrorCode(body: Record<string, unknown>, message: string | null) {
  const combined = `${body.last_error_code ?? ""} ${body.errorCode ?? ""} ${body.status ?? ""} ${message ?? ""}`;
  if (/WORKER_SUBREQUEST_LIMIT|subrequest/i.test(combined)) return "WORKER_SUBREQUEST_LIMIT";
  if (/NITRADO_RATE_LIMITED|HTTP\s*429|rate limit/i.test(combined)) return "NITRADO_RATE_LIMITED";
  if (/NITRADO_UPSTREAM_DOWN|HTTP\s*50[0234]|upstream/i.test(combined)) return "NITRADO_UPSTREAM_DOWN";
  if (/NITRADO_FILE_NOT_FOUND|FILE_MISSING_OR_ROTATED|HTTP\s*404/i.test(combined)) return "file_missing_or_rotated";
  if (/latest_adm_unreadable|adm.*unreadable|not readable/i.test(combined)) return "latest_adm_unreadable";
  if (/no_new_adm|backfill caught up|no due ADM/i.test(combined)) return "no_new_adm";
  return null;
}

function isRecoverableHeartbeatError(errorCode: string | null) {
  return [
    "NITRADO_UPSTREAM_DOWN",
    "NITRADO_RATE_LIMITED",
    "WORKER_SUBREQUEST_LIMIT",
    "file_missing_or_rotated",
    "latest_adm_unreadable",
    "no_new_adm",
    "waiting_for_nitrado",
    "partial_budget_reached",
  ].includes(String(errorCode ?? ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeHeartbeatMessage(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(token|access_token|signature|sig|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 500);
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
  await processRecentAdmBuildReparse(env, { maxFiles: 1, maxRawLines: 1200, maxRuntimeMs: 5000 }).catch((error) => {
    console.warn("DZN ADM WORKER BUILD REPARSE SKIPPED", {
      message: error instanceof Error ? sanitizeHeartbeatMessage(error.message) : "build reparse failed",
    });
  });
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
