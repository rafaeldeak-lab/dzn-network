import assert from "node:assert/strict";

import {
  handleDiscordPostRun,
  isDiscordPostCronAuthorized,
  onRequestGet,
  onRequestOptions,
} from "../functions/api/sync/discord-posts/run";
import type { Env, PagesContext } from "../functions/_lib/types";

const env = {
  DB: {} as D1Database,
  DZN_CRON_SECRET: "unit-test-secret",
} as Env;

async function run() {
  assert.equal(isDiscordPostCronAuthorized(new Request("https://dzn.test", {
    headers: { "x-dzn-cron-secret": "unit-test-secret" },
  }), env), true);
  assert.equal(isDiscordPostCronAuthorized(new Request("https://dzn.test", {
    headers: { "x-dzn-cron-secret": "wrong" },
  }), env), false);

  let waitUntilPromise: Promise<unknown> | null = null;
  let dispatchCalled = false;
  const asyncResponse = await handleDiscordPostRun(makeContext(new Request("https://dzn.test/api/sync/discord-posts/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ source: "cloudflare-scheduled", max_jobs: 2, deadline_ms: 2500, async: true }),
  }), env, (promise) => {
    waitUntilPromise = promise;
  }), {
    dispatch: async (_env, options = {}) => {
      dispatchCalled = true;
      assert.equal(options.maxJobs, 2);
      assert.equal(options.deadlineMs, 2500);
      return {
        ok: true,
        processed: 1,
        edited: 0,
        sent: 1,
        posted: 1,
        skipped: 0,
        failed: 0,
        budgetExhausted: false,
        results: [],
      };
    },
  });

  assert.equal(asyncResponse.status, 202);
  const acceptedJson = await asyncResponse.json() as {
    ok: boolean;
    accepted: boolean;
    max_jobs: number;
    deadline_ms: number;
  };
  assert.deepEqual(acceptedJson, {
    ok: true,
    accepted: true,
    source: "cloudflare",
    cron: null,
    max_jobs: 2,
    deadline_ms: 2500,
  });
  assert.ok(waitUntilPromise);
  await waitUntilPromise;
  assert.equal(dispatchCalled, true);

  const syncResponse = await handleDiscordPostRun(makeContext(new Request("https://dzn.test/api/sync/discord-posts/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ source: "github-backup", max_jobs: 1, deadline_ms: 1000 }),
  }), env), {
    dispatch: async (_env, options = {}) => ({
      ok: true,
      processed: Number(options.maxJobs ?? 0),
      edited: 0,
      sent: 0,
      posted: 0,
      skipped: 1,
      failed: 0,
      budgetExhausted: false,
      results: [],
    }),
  });
  assert.equal(syncResponse.status, 200);
  const syncJson = await syncResponse.json() as { ok: boolean; processed: number; source: string };
  assert.equal(syncJson.ok, true);
  assert.equal(syncJson.processed, 1);
  assert.equal(syncJson.source, "github-backup");

  const unauthorizedResponse = await handleDiscordPostRun(makeContext(new Request("https://dzn.test/api/sync/discord-posts/run", {
    method: "POST",
    headers: { "x-dzn-cron-secret": "wrong" },
    body: "{}",
  }), env), {
    dispatch: async () => {
      throw new Error("should not run without cron secret");
    },
  });
  assert.equal(unauthorizedResponse.status, 401);

  const getResponse = await onRequestGet(makeContext(new Request("https://dzn.test/api/sync/discord-posts/run", {
    method: "GET",
  }), env));
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");

  const optionsResponse = await onRequestOptions(makeContext(new Request("https://dzn.test/api/sync/discord-posts/run", {
    method: "OPTIONS",
  }), env));
  assert.equal(optionsResponse.status, 204);
  assert.equal(optionsResponse.headers.get("allow"), "POST, OPTIONS");
}

function makeContext(request: Request, testEnv: Env, waitUntil: PagesContext["waitUntil"] = () => undefined): PagesContext {
  return {
    request,
    env: testEnv,
    params: {},
    waitUntil,
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}

run().then(() => {
  console.log("Discord posts cron tests passed.");
});
