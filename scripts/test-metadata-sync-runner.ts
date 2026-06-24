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
      assert.equal(options.patchHomeStats, false);
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
    task_status: string;
    taskStatus: string;
    error: string | null;
    error_code: string | null;
    errorCode: string | null;
    warning: string | null;
    warning_code: string | null;
    warningCode: string | null;
    no_op_reason: string | null;
    noOpReason: string | null;
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
  assert.equal(successJson.task_status, "success");
  assert.equal(successJson.taskStatus, "success");
  assert.equal(successJson.error, null);
  assert.equal(successJson.error_code, null);
  assert.equal(successJson.errorCode, null);
  assert.equal(successJson.warning, null);
  assert.equal(successJson.warning_code, null);
  assert.equal(successJson.warningCode, null);
  assert.equal(successJson.no_op_reason, null);
  assert.equal(successJson.noOpReason, null);
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
      assert.equal(options.patchHomeStats, false);
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

  const unavailableWarningResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cron: "github-actions", max_servers: 2, deadline_ms: 5000 }),
  }), env), {
    refreshMetadata: async () => {
      return {
        processed: 2,
        succeeded: 1,
        failed: 1,
        skipped: 0,
        updated_player_counts: 1,
        results: [
          {
            linked_server_id: "nuketown",
            service_id: "18765761",
            server_name: "NukeTown DEATHMATCH",
            status: "succeeded",
            changed: false,
            current_players: 0,
            max_players: 10,
            player_count_status: "fresh",
            player_count_last_checked_at: new Date().toISOString(),
            metadata_last_checked_at: new Date().toISOString(),
            message: "Server info checked; no changes found",
          },
          {
            linked_server_id: "pandora",
            service_id: "17428528",
            server_name: "PANDORA DayZ",
            status: "failed",
            changed: false,
            current_players: null,
            max_players: 22,
            player_count_status: "unavailable",
            player_count_last_checked_at: new Date().toISOString(),
            metadata_last_checked_at: new Date().toISOString(),
            message: "Nitrado live player count endpoint unavailable; keeping previous count",
            phase: "live_player_count",
          },
        ],
      };
    },
  });
  assert.equal(unavailableWarningResponse.status, 200);
  const unavailableWarningJson = await unavailableWarningResponse.json() as {
    ok: boolean;
    task_status: string;
    taskStatus: string;
    error: string | null;
    error_code: string | null;
    errorCode: string | null;
    warning: string | null;
    warning_code: string | null;
    warningCode: string | null;
    processed: number;
    succeeded: number;
    failed: number;
  };
  assert.equal(unavailableWarningJson.ok, true);
  assert.equal(unavailableWarningJson.task_status, "warning");
  assert.equal(unavailableWarningJson.taskStatus, "warning");
  assert.equal(unavailableWarningJson.error, null);
  assert.equal(unavailableWarningJson.error_code, null);
  assert.equal(unavailableWarningJson.errorCode, null);
  assert.match(unavailableWarningJson.warning ?? "", /Nitrado live player count endpoint unavailable/i);
  assert.equal(unavailableWarningJson.warning_code, "nitrado_live_count_unavailable");
  assert.equal(unavailableWarningJson.warningCode, "nitrado_live_count_unavailable");
  assert.equal(unavailableWarningJson.processed, 2);
  assert.equal(unavailableWarningJson.succeeded, 1);
  assert.equal(unavailableWarningJson.failed, 1);

  const realPartialFailureResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cron: "github-actions", max_servers: 2, deadline_ms: 5000 }),
  }), env), {
    refreshMetadata: async () => {
      return {
        processed: 2,
        succeeded: 1,
        failed: 1,
        skipped: 0,
        updated_player_counts: 1,
        results: [
          {
            linked_server_id: "nuketown",
            service_id: "18765761",
            server_name: "NukeTown DEATHMATCH",
            status: "succeeded",
            changed: false,
            current_players: 0,
            max_players: 10,
            player_count_status: "fresh",
            player_count_last_checked_at: new Date().toISOString(),
            metadata_last_checked_at: new Date().toISOString(),
            message: "Server info checked; no changes found",
          },
          {
            linked_server_id: "broken-server",
            service_id: "99999999",
            server_name: "Broken Server",
            status: "failed",
            changed: false,
            current_players: null,
            max_players: null,
            player_count_status: "unknown",
            player_count_last_checked_at: null,
            metadata_last_checked_at: null,
            message: "D1 write failed",
            phase: "write",
          },
        ],
      };
    },
  });
  assert.equal(realPartialFailureResponse.status, 200);
  const realPartialFailureJson = await realPartialFailureResponse.json() as {
    ok: boolean;
    task_status: string;
    taskStatus: string;
    error: string | null;
    error_code: string | null;
    errorCode: string | null;
    warning: string | null;
    warning_code: string | null;
    warningCode: string | null;
  };
  assert.equal(realPartialFailureJson.ok, false);
  assert.equal(realPartialFailureJson.task_status, "partial");
  assert.equal(realPartialFailureJson.taskStatus, "partial");
  assert.match(realPartialFailureJson.error ?? "", /D1 write failed/i);
  assert.equal(realPartialFailureJson.error_code, "metadata_partial_failure");
  assert.equal(realPartialFailureJson.errorCode, "metadata_partial_failure");
  assert.equal(realPartialFailureJson.warning, null);
  assert.equal(realPartialFailureJson.warning_code, null);
  assert.equal(realPartialFailureJson.warningCode, null);

  const noOpResponse = await handleMetadataSyncRun(makeContext(new Request("https://dzn.test/api/sync/metadata/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ cron: "github-actions", max_servers: 1, deadline_ms: 5000 }),
  }), env), {
    refreshMetadata: async () => {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 1,
        updated_player_counts: 0,
        results: [],
      };
    },
  });
  assert.equal(noOpResponse.status, 200);
  const noOpJson = await noOpResponse.json() as {
    ok: boolean;
    task_status: string;
    taskStatus: string;
    error: string | null;
    error_code: string | null;
    errorCode: string | null;
    no_op_reason: string | null;
    noOpReason: string | null;
  };
  assert.equal(noOpJson.ok, true);
  assert.equal(noOpJson.task_status, "no_op");
  assert.equal(noOpJson.taskStatus, "no_op");
  assert.equal(noOpJson.error, null);
  assert.equal(noOpJson.error_code, null);
  assert.equal(noOpJson.errorCode, null);
  assert.equal(noOpJson.no_op_reason, "metadata_no_due_server");
  assert.equal(noOpJson.noOpReason, "metadata_no_due_server");

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
    error_code: string;
    errorCode: string;
  };
  assert.equal(timeoutJson.ok, false);
  assert.equal(timeoutJson.task_status, "timed_out");
  assert.equal(timeoutJson.timed_out, true);
  assert.equal(timeoutJson.budget_exhausted, true);
  assert.equal(timeoutJson.processed, 0);
  assert.equal(timeoutJson.error, "metadata_budget_exhausted_before_work");
  assert.equal(timeoutJson.error_code, "metadata_budget_exhausted_before_work");
  assert.equal(timeoutJson.errorCode, "metadata_budget_exhausted_before_work");

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
  const metadataRunSource = readFileSync("functions/api/sync/metadata/run.ts", "utf8");
  assert.equal(metadataRunSource.includes("patchHomeStats: false"), true, "Scheduled metadata route should not rewrite broad home-stats snapshots.");
  assert.equal(metadataRunSource.includes("stale_over_slo_count"), true, "Metadata route should expose five-minute attempt SLO failures.");
  assert.equal(metadataRunSource.includes("stale_lock_count"), true, "Metadata route should expose stale lock failures.");
  assert.equal(metadataRunSource.includes("hasOnlyExpectedUnavailableFailures"), true, "Metadata route should keep expected Nitrado unavailability separate from partial/internal failures.");
  assert.equal(metadataRunSource.includes("metadataWarningCode"), true, "Metadata route should return machine-readable warning codes.");
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
