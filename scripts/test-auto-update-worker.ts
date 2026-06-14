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
assert.equal(workerSource.includes("for (const task of dueTasks)"), true, "Due auto-update tasks should run sequentially.");
assert.equal(workerSource.includes('cadence: "every-minute"'), true, "Metadata should run every scheduled tick.");
assert.equal(workerSource.includes('cadence: "every-five-minutes"'), true, "Heavier optional tasks should stay on five-minute cadence.");
assert.equal(workerSource.includes("isFiveMinuteTick"), true, "Worker should gate Server Wars and Discord to five-minute ticks.");
assert.equal(workerSource.includes("AbortController"), true, "Each task should enforce a timeout.");
assert.equal(workerSource.includes("recordAutomationCronRun"), true, "Scheduler check-ins should be persisted.");
assert.equal(workerSource.includes("authorization: `Bearer ${secret}`"), true);
assert.equal(workerSource.includes("x-dzn-cron-secret"), true);
assert.equal(workerSource.includes("x-sync-cron-secret"), true);
assert.equal(workerSource.includes("x-cron-secret"), true);
assert.equal(workerSource.includes("/api/sync/adm/run"), false, "Auto-update Worker must not call ADM import routes.");
assert.equal(/TOKEN_ENCRYPTION_KEY|DISCORD_BOT_TOKEN|STRIPE_SECRET/i.test(workerSource), false, "Auto-update Worker must not expose or handle runtime secrets directly.");
assert.equal(automationSource.includes('AutomationCronJobType = "metadata" | "adm" | "discord-posts" | "server-wars"'), true);
assert.equal(automationSource.includes('explicit.includes("cloudflare")'), true);
assert.equal(automationSource.includes('explicit.includes("github")'), true);

async function main() {
  const missingSecret = await runAutoUpdateTick({} as Env, { cron: "test", scheduledTime: Date.now() });
  assert.equal(missingSecret.ok, false);
  assert.equal(missingSecret.results.every((item) => item.skipped === true), true);

  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  let callIndex = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    callIndex += 1;
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers,
    });
    if (callIndex === 2) {
      return new Response(JSON.stringify({ ok: false, failed: 1, error: "temporary server wars failure" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, processed: 1, skipped: 0, failed: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await runAutoUpdateTick({
      DZN_CRON_SECRET: "unit-test-secret",
      DZN_APP_URL: "https://dzn.test",
    } as Env, { cron: "unit-test", scheduledTime: 12345 });
    assert.equal(result.ok, true, "One failed optional task should not fail the whole scheduler tick.");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://dzn.test/api/sync/metadata/run");
    assert.equal(calls[1].url, "https://dzn.test/api/cron/server-wars/refresh");
    assert.equal(calls[2].url, "https://dzn.test/api/sync/discord-posts/run");
    for (const call of calls) {
      assert.equal(call.headers.get("x-dzn-cron-secret"), "unit-test-secret");
      assert.equal(call.headers.get("x-sync-cron-secret"), "unit-test-secret");
      assert.equal(call.headers.get("x-cron-secret"), "unit-test-secret");
      assert.equal(call.headers.get("authorization"), "Bearer unit-test-secret");
    }
    assert.equal("async" in (calls[0].body as Record<string, unknown>), false, "Metadata refresh should complete synchronously so locks and public cache cleanup finish.");
    assert.equal((calls[0].body as { source: string }).source, "cloudflare-live-metadata");
    assert.equal((calls[0].body as { deadline_ms: number }).deadline_ms, 20000);
    assert.equal((calls[0].body as { max_servers: number }).max_servers, 2);
    assert.equal((calls[0].body as { player_count_stale_ms: number }).player_count_stale_ms, 60000);
    assert.equal((calls[1].body as { async: boolean }).async, true);
    assert.equal((calls[1].body as { max_events: number }).max_events, 1);
    assert.equal((calls[2].body as { async: boolean }).async, true);
    assert.equal((calls[2].body as { max_jobs: number }).max_jobs, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  calls.length = 0;
  callIndex = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({ ok: true, processed: 1, skipped: 0, failed: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await runAutoUpdateTick({
      DZN_CRON_SECRET: "unit-test-secret",
      DZN_APP_URL: "https://dzn.test",
    } as Env, { cron: "* * * * *", scheduledTime: Date.UTC(2026, 0, 1, 12, 1, 0) });
    assert.equal(calls.length, 1, "Only metadata should run on non-five-minute scheduled ticks.");
    assert.equal(calls[0].url, "https://dzn.test/api/sync/metadata/run");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("Auto-update Worker tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
