import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  handleMetadataSyncRun,
  isMetadataCronAuthorized,
  onRequestGet,
  onRequestOptions,
} from "../functions/api/sync/metadata/run";
import type { Env, PagesContext } from "../functions/_lib/types";

const env = {
  DB: {} as D1Database,
  DZN_CRON_SECRET: "unit-test-secret",
} as Env;

async function run() {
  assert.equal(isMetadataCronAuthorized(new Request("https://dzn.test", {
    headers: { "x-dzn-cron-secret": "unit-test-secret" },
  }), env), true);
  assert.equal(isMetadataCronAuthorized(new Request("https://dzn.test", {
    headers: { "x-dzn-cron-secret": "wrong" },
  }), env), false);

  let refreshCalled = false;
  const successResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cron: "github-actions", max_servers: 2, deadline_ms: 5000, debug_service_id: "18765761" }),
  }), env), {
    refreshMetadata: async (_env, options = {}) => {
      refreshCalled = true;
      assert.equal(options.maxServers, 2);
      assert.equal(options.deadlineMs, 5000);
      assert.equal(options.debugServiceId, "18765761");
      assert.equal(options.includeResults, true);
      assert.equal(options.queueDiscordUpdates, false);
      assert.equal(options.skipAutomationMaintenance, true);
      return {
        processed: 3,
        succeeded: 3,
        failed: 0,
        skipped: 0,
        updated_player_counts: 2,
        results: [
          {
            linked_server_id: "server-1",
            service_id: "17428528",
            server_name: "PANDORA DayZ",
            status: "succeeded",
            changed: true,
            current_players: 0,
            max_players: 22,
            player_count_status: "fresh",
            player_count_last_checked_at: new Date(0).toISOString(),
            metadata_last_checked_at: new Date(0).toISOString(),
            message: "Server info updated from Nitrado",
          },
        ],
      };
    },
  });

  assert.equal(refreshCalled, true);
  assert.equal(successResponse.status, 200);
  const successJson = await successResponse.json() as {
    ok: boolean;
    processed: number;
    succeeded: number;
    failed: number;
    updated_player_counts: number;
    diagnostics: {
      debug_service_id: string | null;
      selected_service_ids: string[];
      skipped_service_ids: Array<{ service_id: string | null; reason: string }>;
    };
    results: Array<{ current_players: number; max_players: number }>;
  };
  assert.equal(successJson.ok, true);
  assert.equal(successJson.processed, 3);
  assert.equal(successJson.succeeded, 3);
  assert.equal(successJson.failed, 0);
  assert.equal(successJson.updated_player_counts, 2);
  assert.equal(successJson.diagnostics.debug_service_id, "18765761");
  assert.deepEqual(successJson.diagnostics.selected_service_ids, ["17428528"]);
  assert.deepEqual(successJson.diagnostics.skipped_service_ids, []);
  assert.deepEqual(successJson.results[0], {
    linked_server_id: "server-1",
    service_id: "17428528",
    server_name: "PANDORA DayZ",
    status: "succeeded",
    changed: true,
    current_players: 0,
    max_players: 22,
    player_count_status: "fresh",
    player_count_last_checked_at: new Date(0).toISOString(),
    metadata_last_checked_at: new Date(0).toISOString(),
    message: "Server info updated from Nitrado",
  });

  let asyncRequestRefreshCalled = false;
  const asyncResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cron: "github-actions", max_servers: 1, deadline_ms: 5000, async: true }),
  }), env), {
    refreshMetadata: async (_env, options = {}) => {
      asyncRequestRefreshCalled = true;
      assert.equal(options.maxServers, 1);
      assert.equal(options.deadlineMs, 5000);
      assert.equal(options.debugServiceId, null);
      assert.equal(options.includeResults, true);
      assert.equal(options.queueDiscordUpdates, false);
      assert.equal(options.skipAutomationMaintenance, true);
      return {
        processed: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        updated_player_counts: 1,
        results: [],
      };
    },
  });
  assert.equal(asyncResponse.status, 200);
  const asyncJson = await asyncResponse.json() as { ok: boolean; task_status: string; accepted?: boolean };
  assert.equal(asyncJson.ok, true);
  assert.equal(asyncJson.task_status, "success");
  assert.equal(asyncJson.accepted, undefined);
  assert.equal(asyncRequestRefreshCalled, true);

  const timeoutResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cron: "github-actions", max_servers: 2, deadline_ms: 100 }),
  }), env), {
    refreshMetadata: async () => {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        updated_player_counts: 0,
        budget_exhausted: true,
        results: [],
      };
    },
  });
  assert.equal(timeoutResponse.status, 200);
  const timeoutJson = await timeoutResponse.json() as {
    ok: boolean;
    task_status: string;
    timed_out: boolean;
    budget_exhausted: boolean;
    processed: number;
    failed: number;
    error: string;
  };
  assert.equal(timeoutJson.ok, false);
  assert.equal(timeoutJson.task_status, "timed_out");
  assert.equal(timeoutJson.timed_out, true);
  assert.equal(timeoutJson.budget_exhausted, true);
  assert.equal(timeoutJson.processed, 0);
  assert.equal(timeoutJson.error, "metadata_budget_exhausted_before_work");

  const unauthorizedResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: { "x-dzn-cron-secret": "wrong" },
    body: "{}",
  }), env), {
    refreshMetadata: async () => {
      throw new Error("should not run without cron secret");
    },
  });
  assert.equal(unauthorizedResponse.status, 401);

  const getResponse = await onRequestGet(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "GET",
  }), env));
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");

  const optionsResponse = await onRequestOptions(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "OPTIONS",
  }), env));
  assert.equal(optionsResponse.status, 204);
  assert.equal(optionsResponse.headers.get("allow"), "POST, OPTIONS");

  const metadataSource = readFileSync("functions/_lib/server-metadata.ts", "utf8");
  assert.equal(metadataSource.includes("deadlineAtMs - Date.now() - 700"), true, "Scheduled metadata attempts must leave response budget after the safe Nitrado player-count fetch.");
  assert.equal(metadataSource.includes("Math.min(1500"), true, "Scheduled Nitrado player-count fetches must stay below the route deadline.");
  assert.equal(metadataSource.includes("timeoutMs = 2500"), true, "Manual/default metadata refreshes keep the existing safe Nitrado timeout cap.");
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
  console.log("Metadata sync runner tests passed.");
});
