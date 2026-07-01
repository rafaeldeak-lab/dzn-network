import type { Env } from "../functions/_lib/types";
import { processRecentAdmBuildReparse, runAdmWorkerSyncTick } from "../functions/_lib/adm-sync";
import {
  normalizeAutomationCronSource,
  recordAutomationCronRun,
  recoverStuckAutomationLocks,
} from "../functions/_lib/automation";
import { requireDb } from "../functions/_lib/db";
import { processDueEventScoring } from "../functions/_lib/event-hub";

type WorkerScheduledController = {
  cron?: string;
  scheduledTime?: number;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type CronEndpoint = {
  label: "discord-posts" | "server-wars";
  path: string;
  body: Record<string, unknown>;
};

const WORKER_NAME = "dzn-adm-sync-worker";
const DZN_CRON_SECRET_HEADER = "x-dzn-cron-secret";
const DEFAULT_APP_URL = "https://dzn-network.pages.dev";
const CRON_ENDPOINT_TIMEOUT_MS = 55000;
const SCHEDULED_WORKER_RUNTIME_BUDGET_MS = 12_000;
const SCHEDULED_WORKER_MIN_REMAINING_MS = 1_500;
const ADM_WORKER_DIRECT_SYNC_MAX_RUNTIME_MS = 6_000;
const POST_ADM_MAINTENANCE_WORKER_SIDE_TASK_ENABLED = false;
const EVENT_SCORING_WORKER_SIDE_TASK_ENABLED = false;
const SERVER_WARS_WORKER_SIDE_TASK_ENABLED = false;
const DISCORD_POSTS_WORKER_SIDE_TASK_ENABLED = false;
const ADM_WORKER_CURSOR_KEY = "last_adm_linked_server_id";
const ADM_WORKER_LAST_RECOVERY_KEY = "last_automation_lock_recovery_at";
const ADM_WORKER_LAST_BUILD_REPARSE_KEY = "last_adm_build_reparse_at";

const CRON_ENDPOINTS: CronEndpoint[] = [
  {
    label: "server-wars",
    path: "/api/cron/server-wars/refresh",
    body: { source: "cloudflare-worker", max_events: 1, max_finalizations: 1, max_challenge_expirations: 10, deadline_ms: 2500 },
  },
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

type ScheduledRuntimeBudget = {
  startedAtMs: number;
  deadlineMs: number;
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
  const budget = createScheduledRuntimeBudget();
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
    results.push(await runDirectAdmSync(env, options, budget));
    if (POST_ADM_MAINTENANCE_WORKER_SIDE_TASK_ENABLED && hasScheduledRuntimeBudget(budget, 7_000)) {
      await runHourlyPostAdmMaintenance(env, budget).catch((error) => {
        console.warn("DZN ADM WORKER POST-READ MAINTENANCE SKIPPED", {
          message: error instanceof Error ? sanitizeHeartbeatMessage(error.message) : "Unknown maintenance error",
        });
      });
    } else {
      console.warn("DZN ADM WORKER POST-READ MAINTENANCE SKIPPED", {
        message: POST_ADM_MAINTENANCE_WORKER_SIDE_TASK_ENABLED
          ? "scheduled worker runtime budget is low"
          : "post-ADM maintenance is handled outside the ADM Worker to preserve scheduled CPU budget",
      });
    }
    results.push(EVENT_SCORING_WORKER_SIDE_TASK_ENABLED && hasScheduledRuntimeBudget(budget, 9_000)
      ? await runEventScoring(env)
      : skippedForBudgetResult("event-scoring", "Event scoring is handled outside the ADM Worker to preserve scheduled CPU budget."));
    results.push(SERVER_WARS_WORKER_SIDE_TASK_ENABLED && hasScheduledRuntimeBudget(budget, 10_000)
      ? await runCronEndpoint(CRON_ENDPOINTS[0], baseUrl, secret, options, budget)
      : skippedForBudgetResult(CRON_ENDPOINTS[0].label, "Server Wars automation is temporarily cron-route-only to preserve ADM Worker CPU budget."));
    results.push(DISCORD_POSTS_WORKER_SIDE_TASK_ENABLED && hasScheduledRuntimeBudget(budget, 9_000)
      ? await runCronEndpoint(CRON_ENDPOINTS[1], baseUrl, secret, options, budget)
      : skippedForBudgetResult(CRON_ENDPOINTS[1].label, "Discord posts automation is cron-route-only to preserve ADM Worker and Pages CPU budget."));

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

async function runDirectAdmSync(env: Env, options: { cron: string | null; scheduledTime: number }, budget: ScheduledRuntimeBudget) {
  const source = normalizeAutomationCronSource("cloudflare", options.cron ?? "cloudflare-worker");
  const startedAt = new Date().toISOString();
  try {
    const availableRuntimeMs = remainingScheduledRuntimeBudgetMs(budget) - SCHEDULED_WORKER_MIN_REMAINING_MS;
    if (availableRuntimeMs < 1_500) {
      return skippedForBudgetResult("adm", "ADM sync skipped because the scheduled worker runtime budget is too low to start safely.");
    }
    const maxRuntimeMs = Math.max(1_000, Math.min(ADM_WORKER_DIRECT_SYNC_MAX_RUNTIME_MS, availableRuntimeMs));
    const result = await runAdmWorkerSyncTick(env, {
      cron: options.cron ?? "cloudflare-worker",
      maxLinesPerServer: 5000,
      maxRuntimeMs,
      cursorKey: ADM_WORKER_CURSOR_KEY,
      skipMetadataRefresh: true,
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

async function runEventScoring(env: Env) {
  try {
    const result = await processDueEventScoring(env, { maxPhases: 4, maxDiscordMessages: 8 });
    return {
      label: "event-scoring" as const,
      status: 200,
      ok: result.ok,
      body: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event scoring failed";
    console.warn("DZN EVENT SCORING LOOP SKIPPED", {
      message: sanitizeHeartbeatMessage(message),
    });
    return {
      label: "event-scoring" as const,
      status: 200,
      ok: true,
      body: {
        ok: true,
        skipped: true,
        warning: sanitizeHeartbeatMessage(message),
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
  if (/nitrado_auth_invalid|token.*decrypt|cannot be decrypted|TOKEN_ENCRYPTION_KEY|AES-GCM|ciphertext authentication/i.test(combined)) return "nitrado_auth_invalid";
  if (/NITRADO_FILE_NOT_FOUND|FILE_MISSING_OR_ROTATED|HTTP\s*404/i.test(combined)) return "file_missing_or_rotated";
  if (/latest_adm_unreadable|adm.*unreadable|not readable/i.test(combined)) return "latest_adm_unreadable";
  if (/no_new_adm|backfill caught up|no due ADM/i.test(combined)) return "no_new_adm";
  return null;
}

function isRecoverableHeartbeatError(errorCode: string | null) {
  return [
    "NITRADO_UPSTREAM_DOWN",
    "NITRADO_RATE_LIMITED",
    "nitrado_auth_invalid",
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

async function runHourlyPostAdmMaintenance(env: Env, budget: ScheduledRuntimeBudget) {
  const db = requireDb(env);
  const recoveryRow = await db
    .prepare("SELECT value FROM adm_worker_state WHERE key = ? LIMIT 1")
    .bind(ADM_WORKER_LAST_RECOVERY_KEY)
    .first<{ value: string | null }>();
  const buildReparseRow = await db
    .prepare("SELECT value FROM adm_worker_state WHERE key = ? LIMIT 1")
    .bind(ADM_WORKER_LAST_BUILD_REPARSE_KEY)
    .first<{ value: string | null }>();
  const lastRecoveryAt = recoveryRow?.value ? Date.parse(recoveryRow.value) : 0;
  const lastBuildReparseAt = buildReparseRow?.value ? Date.parse(buildReparseRow.value) : 0;
  const recoveryDue = !Number.isFinite(lastRecoveryAt) || Date.now() - lastRecoveryAt >= 60 * 60 * 1000;
  const buildReparseDue = !Number.isFinite(lastBuildReparseAt) || Date.now() - lastBuildReparseAt >= 60 * 60 * 1000;
  if (!recoveryDue && !buildReparseDue) return;

  if (recoveryDue && hasScheduledRuntimeBudget(budget, 4_000)) {
    await recoverStuckAutomationLocks(env);
    await updateAdmWorkerStateTimestamp(db, ADM_WORKER_LAST_RECOVERY_KEY);
  }

  if (buildReparseDue && hasScheduledRuntimeBudget(budget, 6_000)) {
    await processRecentAdmBuildReparse(env, { maxFiles: 1, maxRawLines: 1200, maxRuntimeMs: Math.min(3500, Math.max(1000, remainingScheduledRuntimeBudgetMs(budget) - SCHEDULED_WORKER_MIN_REMAINING_MS)) }).catch((error) => {
      console.warn("DZN ADM WORKER BUILD REPARSE SKIPPED", {
        message: error instanceof Error ? sanitizeHeartbeatMessage(error.message) : "build reparse failed",
      });
    });
    await updateAdmWorkerStateTimestamp(db, ADM_WORKER_LAST_BUILD_REPARSE_KEY);
  }
}

async function updateAdmWorkerStateTimestamp(db: D1Database, key: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO adm_worker_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, now, now)
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
  budget?: ScheduledRuntimeBudget,
) {
  const controller = new AbortController();
  const requestTimeoutMs = budget
    ? Math.max(1_000, Math.min(CRON_ENDPOINT_TIMEOUT_MS, remainingScheduledRuntimeBudgetMs(budget) - 1_000))
    : CRON_ENDPOINT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
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

function createScheduledRuntimeBudget(maxRuntimeMs = SCHEDULED_WORKER_RUNTIME_BUDGET_MS): ScheduledRuntimeBudget {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    deadlineMs: startedAtMs + Math.max(5_000, maxRuntimeMs),
  };
}

function remainingScheduledRuntimeBudgetMs(budget: ScheduledRuntimeBudget) {
  return Math.max(0, budget.deadlineMs - Date.now());
}

function hasScheduledRuntimeBudget(budget: ScheduledRuntimeBudget, minimumRemainingMs = SCHEDULED_WORKER_MIN_REMAINING_MS) {
  return remainingScheduledRuntimeBudgetMs(budget) > minimumRemainingMs;
}

function skippedForBudgetResult(label: string, message: string) {
  console.warn("DZN ADM WORKER SIDE TASK SKIPPED", { label, message });
  return {
    label,
    status: 200,
    ok: true,
    body: {
      ok: true,
      skipped: true,
      warning: message,
    },
  };
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
