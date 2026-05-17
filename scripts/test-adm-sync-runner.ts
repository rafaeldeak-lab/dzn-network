import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyAdmSyncOutcome,
  classifyUnavailableAdmFileStatus,
  compareAdmFileNamesChronological,
  isAdmSyncErrorStatus,
  isAdmSyncTemporarilyUnavailableStatus,
} from "../functions/_lib/adm-sync";
import { parseAdmLines } from "../functions/_lib/adm-parser";
import { handleAdmSyncRun, isCronAuthorized, onRequestGet, onRequestOptions } from "../functions/api/sync/adm/run";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

assert.equal(classifyAdmSyncOutcome({
  pendingLineCount: 0,
  eventsCreated: 0,
  killsCreated: 0,
  buildEventsStored: 0,
}), "no_new_lines");

assert.equal(classifyAdmSyncOutcome({
  pendingLineCount: 4,
  eventsCreated: 0,
  killsCreated: 0,
  buildEventsStored: 0,
}), "no_supported_events");

assert.equal(classifyAdmSyncOutcome({
  pendingLineCount: 4,
  eventsCreated: 2,
  killsCreated: 0,
  buildEventsStored: 0,
}), "completed");

const connectionOnlyLines = parseAdmLines([
  "AdminLog started on 2026-05-17 at 16:02:20",
  "16:02:25 | Player \"SyncTester\" (id=test-player-1) is connecting",
  "16:02:30 | Player \"SyncTester\" (id=test-player-1 pos=<120.0, 450.0, 22.0>) is connected",
  "16:04:30 | Player \"SyncTester\" (id=test-player-1 pos=<122.0, 451.0, 22.0>) has been disconnected",
]);
assert.deepEqual(connectionOnlyLines.map((line) => line.eventType), [
  "admin_log_started",
  "player_connecting",
  "player_connected",
  "player_disconnected",
]);
assert.equal(connectionOnlyLines.some((line) => line.eventType === "player_killed"), false);

assert.equal(isAdmSyncErrorStatus("nitrado_error"), true);
assert.equal(isAdmSyncErrorStatus("write_error"), true);
assert.equal(isAdmSyncErrorStatus("no_new_lines"), false);
assert.equal(isAdmSyncErrorStatus("adm_file_unreadable"), false);
assert.equal(isAdmSyncTemporarilyUnavailableStatus("adm_file_unreadable"), true);
assert.equal(classifyUnavailableAdmFileStatus(null, false), "adm_not_generated_yet");
assert.equal(classifyUnavailableAdmFileStatus("DayZServer_PS4_x64_2026-05-17_16-02-20.ADM", false), "adm_file_unreadable");
assert.equal(classifyUnavailableAdmFileStatus(null, true), "adm_file_unreadable");
assert.equal(classifyUnavailableAdmFileStatus(null, false, "error"), "nitrado_down");
assert.equal(classifyUnavailableAdmFileStatus(null, false, "401"), "nitrado_auth_invalid");
assert.equal(classifyUnavailableAdmFileStatus(null, false, "429"), "nitrado_rate_limited");

const admFilesChronological = [
  "DayZServer_PS4_x64_2026-05-17_18-02-25.ADM",
  "DayZServer_PS4_x64_2026-05-17_16-02-20.ADM",
  "DayZServer_PS4_x64_2026-05-17_17-01-42.ADM",
].sort(compareAdmFileNamesChronological);
assert.deepEqual(admFilesChronological, [
  "DayZServer_PS4_x64_2026-05-17_16-02-20.ADM",
  "DayZServer_PS4_x64_2026-05-17_17-01-42.ADM",
  "DayZServer_PS4_x64_2026-05-17_18-02-25.ADM",
]);
assert.equal(compareAdmFileNamesChronological(
  "DayZServer_PS4_x64_2026-05-17_18-02-25.ADM",
  "DayZServer_PS4_x64_2026-05-17_17-01-42.ADM",
) > 0, true);

const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
assert.equal(admSyncSource.includes("hasExistingPlayerEventBySourceLine"), true);
assert.equal(admSyncSource.includes("DZN ADM FEED SYNC STATUS IMPROVED"), true);
assert.equal(admSyncSource.includes("preferredAdmFileName"), true);
assert.equal(admSyncSource.includes("selectAdmFilesForCursor"), true);
assert.equal(admSyncSource.includes("Kill lines parsed this check"), true);
const nitradoSource = readFileSync("functions/_lib/nitrado.ts", "utf8");
assert.equal(nitradoSource.includes("DZN ADM FILE READ VARIANT USED"), true);
assert.equal(nitradoSource.includes("DZN ADM LATEST FILE SELECTION FIXED"), true);
assert.equal(nitradoSource.includes("fetchReadableNitradoAdmFiles"), true);
const packageSource = readFileSync("package.json", "utf8");
assert.equal(packageSource.includes("diagnose:adm-import"), true);
assert.equal(packageSource.includes("adm:audit-health"), true);
assert.equal(packageSource.includes("adm:backfill-missing"), true);
const diagnoseImportSource = readFileSync("scripts/diagnose-adm-import.ts", "utf8");
assert.equal(diagnoseImportSource.includes("DZN ADM KILL IMPORT DIAGNOSTICS READY"), true);
assert.equal(admSyncSource.includes("adm_sync_file_state"), true);
assert.equal(admSyncSource.includes("DZN ADM SELF HEALING ACTIVE"), true);
assert.equal(admSyncSource.includes("DZN ADM MISSION CRITICAL SYNC READY"), true);
assert.equal(admSyncSource.includes("DZN ADM ONLY BLOCKED BY NITRADO STATUS"), true);
assert.equal(admSyncSource.includes("force: triggerType === \"manual\" || triggerType === \"scheduled\""), true);
assert.equal(admSyncSource.includes("softFail: true"), true);
assert.equal(admSyncSource.includes("refreshLivePlayerCountsForActiveServers"), true);
assert.equal(admSyncSource.includes("metadata,"), true);

const env = { SYNC_CRON_SECRET: "unit-test-secret" } as Env;
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", {
  method: "POST",
  headers: { authorization: "Bearer unit-test-secret" },
}), env), true);
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", {
  method: "POST",
  headers: { authorization: "Bearer wrong" },
}), env), false);
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", { method: "POST" }), {} as Env), false);

const dashboardApi = readFileSync("components/onboarding/api.ts", "utf8");
assert.equal(dashboardApi.includes("/api/sync/adm/run"), true);
const dashboardUi = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardUi.includes("No ADM File"), false);
assert.equal(dashboardUi.includes("ADM File Temporarily Unavailable"), true);
assert.equal(dashboardUi.includes("ADM sync checked Nitrado, but the latest ADM file was not readable this time."), true);
assert.equal(dashboardUi.includes("Feed last updated"), true);
assert.equal(dashboardUi.includes("getDashboardSyncStatusBanner"), true);

runEndpointTests()
  .then(() => {
    console.log("ADM sync runner tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

async function runEndpointTests() {
  const scheduledResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: {
      authorization: "Bearer unit-test-secret",
      "content-type": "application/json",
    },
    body: "{}",
  }), env), {
    runScheduled: async () => ({
      ok: true,
      processed: 1,
      succeeded: 1,
      failed: 0,
      unavailable: 0,
      skipped: 0,
      cron: null,
      maxServers: 25,
      maxLinesPerServer: 50000,
      metadata: {
        processed: 2,
        succeeded: 2,
        failed: 0,
        updated_player_counts: 1,
      },
    }),
    runManual: async () => admSyncResult("manual-not-called"),
    resolveUser: async () => null,
  });
  assert.equal(scheduledResponse.status, 200);
  const scheduledJson = await scheduledResponse.json() as { processed: number; metadata: { updated_player_counts: number } };
  assert.equal(scheduledJson.processed, 1);
  assert.equal(scheduledJson.metadata.updated_player_counts, 1);

  const unauthorizedResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
    body: "{}",
  }), env), {
    runScheduled: async () => ({
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      unavailable: 0,
      skipped: 0,
      cron: null,
      maxServers: 25,
      maxLinesPerServer: 50000,
      metadata: {
        processed: 0,
        succeeded: 0,
        failed: 0,
        updated_player_counts: 0,
      },
    }),
    runManual: async () => admSyncResult("manual-not-called"),
    resolveUser: async () => null,
  });
  assert.equal(unauthorizedResponse.status, 401);

  const manualResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linked_server_id: "server-12345678" }),
  }), env), {
    runScheduled: async () => ({
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      unavailable: 0,
      skipped: 0,
      cron: null,
      maxServers: 25,
      maxLinesPerServer: 50000,
      metadata: {
        processed: 0,
        succeeded: 0,
        failed: 0,
        updated_player_counts: 0,
      },
    }),
    runManual: async (_env, userId, linkedServerId) => admSyncResult(`${userId}:${linkedServerId}`),
    resolveUser: async () => ({
      id: "user-1",
      discord_id: "discord-1",
      username: "Sync User",
      avatar: null,
    } satisfies SessionUser),
  });
  assert.equal(manualResponse.status, 200);
  assert.equal((await manualResponse.json() as { message: string }).message, "user-1:server-12345678");

  const getResponse = await onRequestGet(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "GET",
  }), env));
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");

  const optionsResponse = await onRequestOptions(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "OPTIONS",
  }), env));
  assert.equal(optionsResponse.status, 204);
  assert.equal(optionsResponse.headers.get("allow"), "POST, OPTIONS");
}

function makeContext(request: Request, testEnv: Env): PagesContext {
  return {
    request,
    env: testEnv,
    params: {},
    waitUntil: () => undefined,
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}

function admSyncResult(message: string) {
  return {
    status: "completed",
    message,
    linesSeen: 0,
    linesProcessed: 0,
    eventsCreated: 0,
    killsCreated: 0,
    killsFound: 0,
    newKillsCreated: 0,
    duplicateKillsSkipped: 0,
    playersUpdated: 0,
    latestAdmFile: null,
    lastProcessedLine: 0,
    lastSyncAt: new Date(0).toISOString(),
    readableRouteUsed: null,
    linesRead: 0,
    syncStatus: "completed",
    rawEventsStored: 0,
    playerEventsStored: 0,
    killEventsStored: 0,
    buildEventsStored: 0,
    unknownLines: 0,
    skippedDuplicateLines: 0,
    syncDurationMs: 0,
  };
}
