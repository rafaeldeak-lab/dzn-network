import type { Env } from "../functions/_lib/types";

type WorkerScheduledController = {
  cron?: string;
  scheduledTime?: number;
};

type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

type CronEndpoint = {
  label: "metadata" | "adm" | "discord-posts";
  path: string;
  body: Record<string, unknown>;
};

const WORKER_NAME = "dzn-automation-cron-worker";
const DZN_CRON_SECRET_HEADER = "x-dzn-cron-secret";
const DEFAULT_APP_URL = "https://dzn-network.pages.dev";

const CRON_ENDPOINTS: CronEndpoint[] = [
  {
    label: "metadata",
    path: "/api/sync/metadata/run",
    body: { source: "cloudflare", cron: "cloudflare-worker", max_servers: 50 },
  },
  {
    label: "adm",
    path: "/api/sync/adm/run",
    body: { source: "cloudflare", cron: "cloudflare-worker", max_servers: 50, max_lines_per_server: 50000 },
  },
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
  for (const endpoint of CRON_ENDPOINTS) {
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
    });
    const body = await response.json().catch(() => null);
    results.push({
      label: endpoint.label,
      status: response.status,
      ok: response.ok,
      body,
    });
    if (!response.ok) {
      console.warn("DZN AUTOMATION CRON ENDPOINT FAILED", {
        endpoint: endpoint.label,
        status: response.status,
      });
    }
  }

  console.log("DZN CLOUDFLARE WORKER CRON TICK COMPLETE", {
    ok: results.every((result) => result.ok),
    endpoints: results.map((result) => ({ label: result.label, status: result.status, ok: result.ok })),
  });
  return { ok: results.every((result) => result.ok), results };
}

function appBaseUrl(env: Env) {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return DEFAULT_APP_URL;
  try {
    const url = new URL(configured);
    return url.origin;
  } catch {
    return DEFAULT_APP_URL;
  }
}

function getCronSecret(env: Env) {
  return env.DZN_CRON_SECRET || null;
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
