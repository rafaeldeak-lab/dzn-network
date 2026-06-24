import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runAutoUpdateTick } from "../workers/dzn-auto-update-worker";
import type { Env } from "../functions/_lib/types";

const workerSource = readFileSync("workers/dzn-auto-update-worker.ts", "utf8");
const configSource = readFileSync("wrangler.auto-update.toml", "utf8");
const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");

assert.equal(configSource.includes('name = "dzn-auto-update-worker"'), true);
assert.equal(configSource.includes('crons = ["* * * * *"]'), true);
assert.equal(workerSource.includes("runAutoUpdateTick"), true);
assert.equal(workerSource.includes("/api/sync/metadata/run"), true);
assert.equal(workerSource.includes("/api/cron/server-wars/refresh"), true);
assert.equal(workerSource.includes("/api/sync/discord-posts/run"), true);
assert.equal(workerSource.includes("runServerWarAutomationTick"), true, "Server Wars scheduled work should run directly in the auto-update Worker.");
assert.equal(workerSource.includes("for (const task of dueTasks)"), true, "Due auto-update tasks should run sequentially.");
assert.equal(workerSource.includes('cadence: "every-minute"'), true, "Metadata should run every scheduled tick.");
assert.equal(workerSource.includes('cadence: "every-five-minutes"'), true, "Heavier optional tasks should stay on five-minute cadence.");
assert.equal(workerSource.includes("isFiveMinuteTick"), true, "Worker should gate Server Wars and Discord to five-minute ticks.");
assert.equal(workerSource.includes("AbortController"), true, "Each task should enforce a timeout.");
assert.equal(workerSource.includes("recordAutomationCronRun"), true, "Scheduler check-ins should be persisted.");
assert.equal(workerSource.includes("toServerWarsTaskContract"), true, "Direct Server Wars work should expose the same completed task contract as the protected route.");
assert.equal(workerSource.includes("no_due_server_war_work"), true, "Direct Server Wars no-op work must include an explicit reason.");
assert.equal(workerSource.includes("body?.taskStatus ?? body?.task_status"), true, "HTTP task result parsing should accept camelCase and snake_case task status fields.");
assert.equal(workerSource.includes("invalid_contract"), true, "HTTP 200 without a task completion status must not be treated as success.");
assert.equal(workerSource.includes("task_missing_completion_status"), true, "Invalid route contracts should record a meaningful error.");
assert.equal(workerSource.includes("no_op_reason"), true, "Sanitized worker task bodies should retain no-op reasons.");
assert.equal(workerSource.includes("warning_code"), true, "Sanitized worker task bodies should retain warning codes.");
assert.equal(workerSource.includes("error_code"), true, "Sanitized worker task bodies should retain error codes.");
assert.equal(workerSource.includes("authorization: `Bearer ${secret}`"), true);
assert.equal(workerSource.includes("x-dzn-cron-secret"), true);
assert.equal(workerSource.includes("x-sync-cron-secret"), true);
assert.equal(workerSource.includes("x-cron-secret"), true);
assert.equal(workerSource.includes("/api/sync/adm/run"), false, "Auto-update Worker must not call ADM import routes.");
assert.equal(/TOKEN_ENCRYPTION_KEY|DISCORD_BOT_TOKEN|STRIPE_SECRET/i.test(workerSource), false, "Auto-update Worker must not expose or handle runtime secrets directly.");
assert.equal(automationSource.includes('AutomationCronJobType = "metadata" | "adm" | "discord-posts" | "server-wars"'), true);
assert.equal(automationSource.includes('explicit.includes("cloudflare")'), true);
assert.equal(automationSource.includes('explicit.includes("github")'), true);

type FetchCall = { url: string; body: Record<string, unknown> | null; headers: Headers };

function makeNoOpD1(): D1Database {
  const statement: Record<string, unknown> = {};
  statement.bind = () => statement;
  statement.first = async () => null;
  statement.all = async () => ({ results: [], success: true, meta: {} });
  statement.run = async () => ({ success: true, meta: {} });
  statement.raw = async () => [];

  return {
    prepare: () => statement,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function makeWorkerEnv() {
  return {
    DZN_CRON_SECRET: "unit-test-secret",
    DZN_APP_URL: "https://dzn.test",
    DB: makeNoOpD1(),
  } as Env;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withMockFetch<T>(
  fetchImpl: typeof fetch,
  callback: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const missingSecret = await runAutoUpdateTick({} as Env, { cron: "test", scheduledTime: Date.now() });
  assert.equal(missingSecret.ok, false);
  assert.equal(missingSecret.results.every((item) => item.skipped === true), true);

  for (const testCase of [
    {
      name: "warning",
      body: {
        ok: true,
        taskStatus: "warning",
        warningCode: "nitrado_live_count_unavailable",
        warning: "Nitrado live player count endpoint unavailable",
        processed: 2,
        succeeded: 1,
        failed: 1,
      },
      status: 200,
      expectedOk: true,
    },
    {
      name: "no_op",
      body: {
        ok: true,
        task_status: "no_op",
        no_op_reason: "metadata_no_due_server",
        processed: 0,
        skipped: 1,
        failed: 0,
      },
      status: 200,
      expectedOk: true,
    },
    {
      name: "success",
      body: {
        ok: true,
        task_status: "success",
        processed: 1,
        skipped: 0,
        failed: 0,
      },
      status: 200,
      expectedOk: true,
    },
    {
      name: "partial",
      body: {
        ok: true,
        task_status: "partial",
        error: "write: D1 write failed",
        processed: 2,
        succeeded: 1,
        failed: 1,
      },
      status: 200,
      expectedOk: false,
    },
    {
      name: "missing task status",
      body: {
        ok: true,
        processed: 1,
        skipped: 0,
        failed: 0,
      },
      status: 200,
      expectedOk: false,
    },
    {
      name: "accepted",
      body: {
        ok: true,
        accepted: true,
        processed: 0,
        skipped: 0,
        failed: 0,
      },
      status: 202,
      expectedOk: false,
    },
  ]) {
    const result = await withMockFetch(
      (async () => jsonResponse(testCase.body, testCase.status)) as typeof fetch,
      () => runAutoUpdateTick(makeWorkerEnv(), {
        cron: "* * * * *",
        scheduledTime: Date.UTC(2026, 0, 1, 12, 1, 0),
      }),
    );
    assert.equal(result.results[0].ok, testCase.expectedOk, `HTTP task status ${testCase.name} should map to ok=${testCase.expectedOk}.`);
    assert.equal(result.ok, testCase.expectedOk, `Single-task tick status ${testCase.name} should map to ok=${testCase.expectedOk}.`);
  }

  const calls: FetchCall[] = [];
  await withMockFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers,
      });
      if (String(input).endsWith("/api/sync/metadata/run")) {
        return jsonResponse({
          ok: true,
          taskStatus: "warning",
          warningCode: "nitrado_live_count_unavailable",
          warning: "Nitrado live player count endpoint unavailable",
          processed: 2,
          succeeded: 1,
          failed: 1,
        });
      }
      return jsonResponse({ ok: true, task_status: "success", processed: 1, skipped: 0, failed: 0 });
    }) as typeof fetch,
    async () => {
      const result = await runAutoUpdateTick(makeWorkerEnv(), {
        cron: "manual-auto-update-test",
        scheduledTime: Date.UTC(2026, 0, 1, 12, 0, 0),
      });
      assert.equal(result.ok, true, "Metadata warning, Server Wars no-op, and Discord success should complete the tick.");
      assert.deepEqual(result.results.map((item) => item.label), ["metadata", "server-wars", "discord-posts"]);
      assert.equal(result.results.every((item) => item.label !== "adm"), true, "ADM must not be included in the auto-update Worker.");
      assert.equal(result.results[0].ok, true);
      assert.equal(result.results[1].ok, true);
      assert.equal("body" in result.results[1], true);
      const serverWarsBody = "body" in result.results[1]
        ? result.results[1].body as { task_status?: string } | null
        : null;
      assert.equal(serverWarsBody?.task_status, "no_op");
      assert.equal(result.results[2].ok, true);
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://dzn.test/api/sync/metadata/run");
  assert.equal(calls[1].url, "https://dzn.test/api/sync/discord-posts/run");
  for (const call of calls) {
    assert.equal(call.headers.get("x-dzn-cron-secret"), "unit-test-secret");
    assert.equal(call.headers.get("x-sync-cron-secret"), "unit-test-secret");
    assert.equal(call.headers.get("x-cron-secret"), "unit-test-secret");
    assert.equal(call.headers.get("authorization"), "Bearer unit-test-secret");
  }
  assert.equal("async" in (calls[0].body ?? {}), false, "Metadata refresh should run as one bounded protected route call, not a long Pages waitUntil task.");
  assert.equal((calls[0].body as { source: string }).source, "cloudflare-live-metadata");
  assert.equal((calls[0].body as { deadline_ms: number }).deadline_ms, 2500);
  assert.equal((calls[0].body as { max_servers: number }).max_servers, 1);
  assert.equal((calls[0].body as { player_count_stale_ms: number }).player_count_stale_ms, 60000);
  assert.equal("async" in (calls[1].body ?? {}), false, "Discord dispatch should run as one bounded protected route call, not a Pages waitUntil acknowledgement.");
  assert.equal((calls[1].body as { max_posts: number }).max_posts, 1);
  assert.equal((calls[1].body as { mode: string }).mode, "single_bounded");

  calls.length = 0;
  await withMockFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: new Headers(init?.headers),
      });
      if (String(input).endsWith("/api/sync/metadata/run")) {
        return jsonResponse({
          ok: true,
          taskStatus: "partial",
          error: "write: D1 write failed",
          processed: 2,
          succeeded: 1,
          failed: 1,
        });
      }
      return jsonResponse({ ok: true, taskStatus: "success", processed: 1, skipped: 0, failed: 0 });
    }) as typeof fetch,
    async () => {
      const result = await runAutoUpdateTick(makeWorkerEnv(), {
        cron: "manual-auto-update-test",
        scheduledTime: Date.UTC(2026, 0, 1, 12, 0, 0),
      });
      assert.equal(result.ok, false, "Metadata partial must fail the overall tick even when later tasks succeed.");
      assert.deepEqual(result.results.map((item) => item.label), ["metadata", "server-wars", "discord-posts"]);
      assert.equal(result.results[0].ok, false, "Partial metadata task must be rejected.");
      assert.equal(result.results[1].ok, true, "Server Wars no-op should remain acceptable.");
      assert.equal(result.results[2].ok, true, "Discord success should remain acceptable.");
    },
  );
  assert.equal(calls.map((call) => call.url).includes("https://dzn.test/api/sync/discord-posts/run"), true, "Every due task should still be attempted after an earlier task fails.");

  calls.length = 0;
  await withMockFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: new Headers(init?.headers),
      });
      return jsonResponse({ ok: true, task_status: "success", processed: 1, skipped: 0, failed: 0 });
    }) as typeof fetch,
    () => runAutoUpdateTick(makeWorkerEnv(), {
      cron: "* * * * *",
      scheduledTime: Date.UTC(2026, 0, 1, 12, 1, 0),
    }),
  );
  assert.equal(calls.length, 1, "Only metadata should run on non-five-minute scheduled ticks.");
  assert.equal(calls[0].url, "https://dzn.test/api/sync/metadata/run");

  console.log("Auto-update Worker tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
