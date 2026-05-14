import { runScheduledAdmSync } from "../functions/_lib/adm-sync";
import type { Env } from "../functions/_lib/types";

type WorkerScheduledController = {
  cron?: string;
  scheduledTime?: number;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

const WORKER_NAME = "adm-sync-worker";

export async function scheduled(
  event: WorkerScheduledController,
  env: Env,
  ctx: WorkerExecutionContext,
) {
  ctx.waitUntil(
    runScheduledAdmSync(env, {
      cron: event.cron ?? null,
      maxServers: 10,
      maxLinesPerServer: 1000,
      minSyncIntervalMs: 120000,
    }),
  );
}

export async function fetch(request: Request, env: Env, _ctx?: WorkerExecutionContext) {
  void _ctx;
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    if (!isHealthAuthorized(request, env)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    return json({ ok: true, worker: WORKER_NAME });
  }

  return json({ ok: false, error: "Not found" }, 404);
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
