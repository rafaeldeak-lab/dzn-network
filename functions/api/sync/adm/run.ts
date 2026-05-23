import { runAdmSync } from "../../../_lib/adm-sync";
import { normalizeAutomationCronSource, recordAutomationCronRun } from "../../../_lib/automation";
import { DZN_CRON_SECRET_HEADER, isCronSecretAuthorized, requireCronSecret } from "../../../_lib/cron-auth";
import { ensureMockUser, getSessionUser, SESSION_COOKIE } from "../../../_lib/db";
import { json, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import type { Env, PagesContext, PagesFunction, SessionUser } from "../../../_lib/types";

type AdmSyncRunBody = {
  cron?: string;
  source?: string;
  linked_server_id?: string;
  max_servers?: number;
  max_lines_per_server?: number;
};

type AdmSyncRunHandlers = {
  runManual: typeof runAdmSync;
  resolveUser: typeof resolveUser;
};

const DEFAULT_HANDLERS: AdmSyncRunHandlers = {
  runManual: runAdmSync,
  resolveUser,
};

export const onRequestPost: PagesFunction = (context) => handleAdmSyncRun(context);

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: {
    Allow: "POST, OPTIONS",
  },
});

export const onRequestGet: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["POST"] },
  {
    status: 405,
    headers: {
      Allow: "POST",
    },
  },
);

export async function handleAdmSyncRun(
  { request, env }: PagesContext,
  handlers: AdmSyncRunHandlers = DEFAULT_HANDLERS,
) {
  if (isCronAuthorized(request, env)) {
    const unauthorized = requireCronSecret(request, env);
    if (unauthorized) return unauthorized;
    const body = await readJson<AdmSyncRunBody>(request);
    const source = normalizeAutomationCronSource(body.source, body.cron);
    const startedAt = new Date().toISOString();
    try {
      await safeRecordCronRun(env, source, "success", startedAt, undefined, {
        processedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      });
    } catch (error) {
      await safeRecordCronRun(env, source, "failed", startedAt, error);
      const message = error instanceof Error ? error.message : "ADM sync failed";
      return json({
        ok: false,
        error: "ADM sync failed",
        message,
        source,
      }, { status: 500 });
    }
    console.log("DZN ADM SYNC PAGES ENDPOINT DELEGATED TO WORKER", {
      source,
      max_servers_requested: sanitizePositiveInteger(body.max_servers, 25),
    });
    return json({
      ok: true,
      source,
      delegated: true,
      worker: "dzn-adm-sync-worker",
      message: "Scheduled ADM sync runs directly inside dzn-adm-sync-worker. This Pages endpoint records the trigger only and does not call Nitrado.",
    });
  }

  if (request.headers.has(DZN_CRON_SECRET_HEADER)) {
    const unauthorized = requireCronSecret(request, env);
    if (unauthorized) return unauthorized;
  }

  if (!requestHasSessionCookie(request) && handlers.resolveUser === DEFAULT_HANDLERS.resolveUser) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await handlers.resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<AdmSyncRunBody>(request);
  try {
    const result = await handlers.runManual(env, user.id, sanitizeLinkedServerId(body.linked_server_id), {
      triggerType: "manual",
      maxLinesPerRun: sanitizePositiveInteger(body.max_lines_per_server, 50000),
    });
    await safeRecordCronRun(env, "manual", "success", new Date().toISOString());
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "ADM sync failed" }, { status: 400 });
  }
}

export function isCronAuthorized(request: Request, env: Env) {
  return isCronSecretAuthorized(request, env);
}

function requestHasSessionCookie(request: Request) {
  return request.headers.get("cookie")?.split(";").some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`)) ?? false;
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.trunc(number), 100000) : fallback;
}

async function safeRecordCronRun(
  env: Env,
  source: ReturnType<typeof normalizeAutomationCronSource>,
  status: "started" | "success" | "failed" | "partial",
  startedAt: string,
  error?: unknown,
  metrics: { processedCount?: number; skippedCount?: number; failedCount?: number } = {},
) {
  const finishedAt = new Date().toISOString();
  try {
    await recordAutomationCronRun(env, {
      source,
      jobType: "adm",
      status,
      startedAt,
      finishedAt,
      errorMessage: error instanceof Error ? error.message : null,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
      ...metrics,
    });
  } catch (error) {
    console.warn("DZN AUTOMATION CRON RUN RECORD SKIPPED", {
      endpoint: "adm",
      message: error instanceof Error ? error.message : "record failed",
    });
  }
}
