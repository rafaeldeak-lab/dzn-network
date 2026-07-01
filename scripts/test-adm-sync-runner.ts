import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyAdmSyncOutcome,
  classifyUnavailableAdmFileStatus,
  compareAdmFileNamesChronological,
  detectAdmRestartFromFiles,
  isAdmDelayedAfterRestart,
  isAdmSyncErrorStatus,
  isAdmSyncTemporarilyUnavailableStatus,
  normalizeAdmSyncStateMachineStatus,
} from "../functions/_lib/adm-sync";
import { parseAdmLines } from "../functions/_lib/adm-parser";
import {
  debugNitradoAdmFileDiscovery,
  fetchReadableNitradoAdmFiles,
  parseNitradoAdmFilenameTimestamp,
  readAdmFileTextWithFallback,
  readNitradoAdminLogs,
} from "../functions/_lib/nitrado";
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
assert.equal(isAdmSyncTemporarilyUnavailableStatus("latest_adm_unreadable"), true);
assert.equal(isAdmSyncTemporarilyUnavailableStatus("waiting_after_restart"), true);
assert.equal(classifyUnavailableAdmFileStatus(null, false), "adm_not_generated_yet");
assert.equal(classifyUnavailableAdmFileStatus("DayZServer_PS4_x64_2026-05-17_16-02-20.ADM", false), "adm_file_unreadable");
assert.equal(classifyUnavailableAdmFileStatus(null, true), "adm_file_unreadable");
assert.equal(classifyUnavailableAdmFileStatus(null, false, "error"), "nitrado_down");
assert.equal(classifyUnavailableAdmFileStatus(null, false, "401"), "nitrado_auth_invalid");
assert.equal(classifyUnavailableAdmFileStatus(null, false, "429"), "nitrado_rate_limited");
assert.equal(classifyUnavailableAdmFileStatus(null, false, null, "2026-05-17T16:00:00.000Z", Date.parse("2026-05-17T17:00:01.000Z")), "delayed_after_restart");
assert.equal(isAdmDelayedAfterRestart("2026-05-17T16:00:00.000Z", Date.parse("2026-05-17T16:44:59.000Z")), false);
assert.equal(isAdmDelayedAfterRestart("2026-05-17T16:00:00.000Z", Date.parse("2026-05-17T16:45:00.000Z")), true);
assert.equal(detectAdmRestartFromFiles("DayZServer_PS4_x64_2026-05-17_16-02-20.ADM", "DayZServer_PS4_x64_2026-05-17_17-02-20.ADM"), true);
assert.equal(detectAdmRestartFromFiles("DayZServer_PS4_x64_2026-05-17_17-02-20.ADM", "DayZServer_PS4_x64_2026-05-17_16-02-20.ADM"), false);
assert.equal(normalizeAdmSyncStateMachineStatus("completed"), "new_data_found");
assert.equal(normalizeAdmSyncStateMachineStatus("no_new_lines"), "no_new_log_available");
assert.equal(normalizeAdmSyncStateMachineStatus("adm_file_unreadable"), "latest_adm_unreadable");
assert.equal(normalizeAdmSyncStateMachineStatus("adm_not_generated_yet"), "waiting_after_restart");

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
const may26AdmFiles = [
  "DayZServer_PS4_x64_2026-05-26_04-02-17.ADM",
  "DayZServer_PS4_x64_2026-05-26_05-01-51.ADM",
  "DayZServer_PS4_x64_2026-05-26_06-01-40.ADM",
  "DayZServer_PS4_x64_2026-05-26_07-02-39.ADM",
];
assert.equal(parseNitradoAdmFilenameTimestamp(may26AdmFiles[0]), Date.UTC(2026, 4, 26, 4, 2, 17));
assert.deepEqual([...may26AdmFiles].sort(compareAdmFileNamesChronological), may26AdmFiles);
assert.equal(compareAdmFileNamesChronological(
  "DayZServer_PS4_x64_2026-05-17_18-02-25.ADM",
  "DayZServer_PS4_x64_2026-05-17_17-01-42.ADM",
) > 0, true);
assert.equal(
  compareAdmFileNamesChronological(
    "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM",
    "DayZServer_PS4_x64_2026-05-19_21-01-43.ADM",
  ) > 0,
  true,
);
assert.equal(
  parseNitradoAdmFilenameTimestamp("dayzps/config/DayZServer_PS4_x64_2026-05-20_06-02-03.ADM"),
  Date.UTC(2026, 4, 20, 6, 2, 3),
);
assert.equal(
  compareAdmFileNamesChronological(
    "DayZServer_PS4_x64_2026-05-20_08-02-52.ADM",
    "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM",
  ) > 0,
  true,
);

const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
const endpointSource = readFileSync("functions/api/sync/adm/run.ts", "utf8");
assert.equal(admSyncSource.includes("hasExistingPlayerEventBySourceLine"), true);
assert.equal(admSyncSource.includes("DZN ADM FEED SYNC STATUS IMPROVED"), true);
assert.equal(admSyncSource.includes("preferredAdmFileName"), true);
assert.equal(admSyncSource.includes("selectAdmFilesForCursor"), true);
assert.equal(admSyncSource.includes("Kill lines parsed this check"), true);
assert.equal(admSyncSource.includes("waiting_after_restart"), true);
assert.equal(admSyncSource.includes("latest_adm_unreadable"), true);
assert.equal(admSyncSource.includes("delayed_after_restart"), true);
assert.equal(admSyncSource.includes("detectAdmRestartFromFiles"), true);
assert.equal(admSyncSource.includes("selectNewestDiscoveredAdmFile"), true);
assert.equal(admSyncSource.includes("compareAdmCandidatesChronological"), true);
const nitradoSource = readFileSync("functions/_lib/nitrado.ts", "utf8");
assert.equal(nitradoSource.includes("DZN ADM FILE READ VARIANT USED"), true);
assert.equal(nitradoSource.includes("DZN ADM LATEST FILE SELECTION FIXED"), true);
assert.equal(nitradoSource.includes("fetchReadableNitradoAdmFiles"), true);
assert.equal(nitradoSource.includes("debugNitradoAdmFileDiscovery"), true);
assert.equal(nitradoSource.includes("candidates: allEntries.map"), true);
assert.equal(nitradoSource.includes("nitrado_api_log_files_stale_or_missing"), true);
assert.equal(nitradoSource.includes("fullDownloadFallback"), true);
assert.equal(nitradoSource.includes("download_fallback_attempted"), true);
assert.equal(nitradoSource.includes("selected_read_method"), true);
assert.equal(nitradoSource.includes("findFirstArrayByKeys"), true);
assert.equal(nitradoSource.includes("fetchNitradoLogSettingsVerification"), true);
assert.equal(nitradoSource.includes("admin_log_enabled"), true);
assert.equal(nitradoSource.includes("server_log_enabled"), true);
assert.equal(nitradoSource.includes("function isEnabled"), true);
assert.equal(nitradoSource.includes("function isDisabled"), true);
const packageSource = readFileSync("package.json", "utf8");
assert.equal(packageSource.includes("diagnose:adm-import"), true);
assert.equal(packageSource.includes("adm:audit-health"), true);
assert.equal(packageSource.includes("debug:adm-discovery"), true);
assert.equal(packageSource.includes("adm:backfill-missing"), true);
const admDiscoveryDebugEndpointSource = readFileSync("functions/api/servers/[serverId]/adm-file-discovery/debug.ts", "utf8");
assert.equal(admDiscoveryDebugEndpointSource.includes("debugNitradoAdmFileDiscovery"), true);
assert.equal(admDiscoveryDebugEndpointSource.includes("TOKEN_ENCRYPTION_KEY"), true);
assert.equal(admDiscoveryDebugEndpointSource.includes("current_saved_state"), true);
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
assert.equal(endpointSource.includes("dzn-adm-sync-worker"), true);
assert.equal(endpointSource.includes("does not call Nitrado"), true);
assert.equal(admSyncSource.includes("runAdmDiscoveryForLinkedServer"), true);
assert.equal(admSyncSource.includes("readMode: \"sample\""), true);
assert.equal(admSyncSource.includes("discovery_due_count"), true);
assert.equal(admSyncSource.includes("processing_due_count"), true);
assert.equal(admSyncSource.includes("skipped_unreadable"), true);
assert.equal(admSyncSource.includes("recordAdmCadenceObservation"), true);
assert.equal(admSyncSource.includes("isUsefulAdmCadenceEvent"), true);
assert.equal(admSyncSource.includes("lastPlayerlistAt"), true);
assert.equal(admSyncSource.includes("targetFileName?: string | null"), true);
assert.equal(admSyncSource.includes("targetFilePath?: string | null"), true);
assert.equal(admSyncSource.includes("sanitizeWorkerTargetAdmPath"), true);
assert.equal(admSyncSource.includes("selected_adm_path"), true);
assert.equal(admSyncSource.includes("adm_worker_selection_state"), true);
assert.equal(admSyncSource.includes("next_adm_discovery_due_at"), true);
assert.equal(admSyncSource.includes("next_adm_pull_due_at"), true);
assert.equal(admSyncSource.includes("const admWorkDueNow = isIsoDueNow(selected.next_adm_discovery_due_at) || isIsoDueNow(selected.next_adm_pull_due_at);"), true);
assert.match(admSyncSource, /admWorkDueNow[\s\S]*\?\s+"due_discovery"[\s\S]*Number\(selected\.metadata_stale/, "Due ADM discovery/pull must not be skipped as metadata-only stale work.");
assert.equal(admSyncSource.includes("Saved Nitrado token cannot be decrypted. Re-save the server owner's Nitrado long-life token."), true);
assert.equal(admSyncSource.includes("DZN ADM WORKER TOKEN DECRYPT SKIPPED SERVER"), true);
assert.equal(admSyncSource.includes("DZN ADM WORKER DISCOVERY TOKEN DECRYPT SKIPPED SERVER"), true);
assert.equal(admSyncSource.includes("isNitradoTokenDecryptFailure"), true);
assert.match(admSyncSource, /planAdmBackfillJobsForServer[\s\S]*catch \(error\)[\s\S]*isNitradoTokenDecryptFailure[\s\S]*updateAdmWorkerCursor[\s\S]*unavailable: 1/, "Discovery token decrypt failures must be isolated as recoverable per-server states.");
assert.match(admSyncSource, /catch \(error\)[\s\S]*updateAdmWorkerCursor[\s\S]*unavailable: 1/, "A bad saved Nitrado token must be isolated as a recoverable per-server state.");
assert.equal(admSyncSource.includes("refreshNitradoServerMetadata(env, {"), true);
assert.equal(admSyncSource.includes("skipMetadataRefresh: true"), true);
assert.equal(admSyncSource.includes("gameserver_details_log_files_noftp_download"), true);
assert.equal(admSyncSource.includes("server stats rebuild"), true);
const automationSource = readFileSync("functions/_lib/automation.ts", "utf8");
assert.equal(automationSource.includes("first_adm_after_restart_delay_minutes"), true);
assert.equal(automationSource.includes("observed_playerlist_interval_minutes"), true);
const cadenceMigrationSource = readFileSync("migrations/0020_adm_observed_cadence.sql", "utf8");
assert.equal(cadenceMigrationSource.includes("last_useful_adm_event_at"), true);

const env = { DZN_CRON_SECRET: "unit-test-secret" } as Env;
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", {
  method: "POST",
  headers: { "x-dzn-cron-secret": "unit-test-secret" },
}), env), true);
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", {
  method: "POST",
  headers: { "x-dzn-cron-secret": "wrong" },
}), env), false);
assert.equal(isCronAuthorized(new Request("https://dzn.test/api/sync/adm/run", { method: "POST" }), {} as Env), false);

const dashboardApi = readFileSync("components/onboarding/api.ts", "utf8");
assert.equal(dashboardApi.includes("/api/sync/adm/run"), true);
assert.equal(dashboardApi.includes("/api/servers/${encodeURIComponent(linkedServerId)}/adm/auto-sync-now"), true);
assert.equal(dashboardApi.includes("mode: \"target_file\""), true);
assert.equal(dashboardApi.includes("isStructuredAdmAutoSyncResponse"), true);
assert.equal(dashboardApi.includes("upstreamHttpStatus"), true);
assert.equal(dashboardApi.includes("recoverable === true"), true);
const scopedAutoSyncEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/auto-sync-now.ts", "utf8");
assert.equal(scopedAutoSyncEndpointSource.includes("parseTargetFilePayload"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("NITRADO_UPSTREAM_DOWN"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("dayzps/config/${fileName}"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("latest_read_issue"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("appHttpStatus: 200"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("upstreamHttpStatus"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("invalid_adm_filename"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("invalid_adm_file_path"), true);
assert.equal(scopedAutoSyncEndpointSource.includes("worker_subrequest_limit"), true);
const dashboardHealthSource = readFileSync("functions/api/servers/[serverId]/dashboard/health.ts", "utf8");
assert.equal(dashboardHealthSource.includes("nitrado_file_read_attempts"), true);
assert.equal(dashboardHealthSource.includes("normalizeLatestReadTruth"), true);
assert.equal(dashboardHealthSource.includes("latest_classified_error"), true);
assert.equal(dashboardHealthSource.includes("last_attempted_adm_read"), true);
assert.equal(dashboardHealthSource.includes("latest_completed_import"), true);
const dashboardUi = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardUi.includes("No ADM File"), false);
assert.equal(dashboardUi.includes("Latest ADM Not Readable Yet"), true);
assert.equal(dashboardUi.includes("Latest ADM file found but not readable yet. DZN will retry on the next scheduled check."), true);
assert.equal(dashboardUi.includes("Run Auto-Sync Now"), true);
assert.equal(dashboardUi.includes("Auto-Sync Result"), true);
assert.equal(dashboardUi.includes("Server restart detected. Waiting for Nitrado to publish the next ADM log."), true);
assert.equal(dashboardUi.includes("Check Nitrado Log Settings"), true);
assert.equal(dashboardUi.includes("Nitrado log settings verified automatically"), true);
assert.equal(dashboardUi.includes("Feed last updated"), true);
assert.equal(dashboardUi.includes("getDashboardSyncStatusBanner"), true);
assert.equal(dashboardUi.includes("latest_completed_import"), true);
assert.equal(dashboardUi.includes("last_attempted_adm_read"), true);
assert.equal(dashboardUi.includes("Optional exact ADM filename"), true);
assert.equal(dashboardUi.includes("getAdmAutoSyncResultBadge"), true);
assert.equal(dashboardUi.includes("Attempted File"), true);
assert.equal(dashboardUi.includes("HTTP Status"), true);
assert.equal(dashboardUi.includes("ADM file path must be the filename or dayzps/config/<filename>."), true);

runAdmSyncRunnerTests()
  .then(() => {
    console.log("ADM sync runner tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

async function runAdmSyncRunnerTests() {
  await runEndpointTests();
  await runNitradoAdminLogsTests();
  await runNitradoReadFallbackTests();
}

async function runEndpointTests() {
  const scheduledResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: {
      "x-dzn-cron-secret": "unit-test-secret",
      "content-type": "application/json",
    },
    body: "{}",
  }), env), {
    runManual: async () => admSyncResult("manual-not-called"),
    resolveUser: async () => null,
  });
  assert.equal(scheduledResponse.status, 200);
  const scheduledJson = await scheduledResponse.json() as { ok: boolean; delegated: boolean; worker: string };
  assert.equal(scheduledJson.ok, true);
  assert.equal(scheduledJson.delegated, true);
  assert.equal(scheduledJson.worker, "dzn-adm-sync-worker");

  const unauthorizedResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: { "x-dzn-cron-secret": "wrong" },
    body: "{}",
  }), env), {
    runManual: async () => admSyncResult("manual-not-called"),
    resolveUser: async () => null,
  });
  assert.equal(unauthorizedResponse.status, 401);

  const manualResponse = await handleAdmSyncRun(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linked_server_id: "server-12345678" }),
  }), env), {
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
  assert.equal(getResponse.status, 401);

  const authenticatedGetResponse = await onRequestGet(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "GET",
    headers: { "x-dzn-cron-secret": "unit-test-secret" },
  }), env));
  assert.equal(authenticatedGetResponse.status, 405);
  assert.equal(authenticatedGetResponse.headers.get("allow"), "POST");

  const optionsResponse = await onRequestOptions(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "OPTIONS",
  }), env));
  assert.equal(optionsResponse.status, 401);

  const authenticatedOptionsResponse = await onRequestOptions(makeContext(new Request("https://dzn.test/api/sync/adm/run", {
    method: "OPTIONS",
    headers: { "x-dzn-cron-secret": "unit-test-secret" },
  }), env));
  assert.equal(authenticatedOptionsResponse.status, 204);
  assert.equal(authenticatedOptionsResponse.headers.get("allow"), "POST, OPTIONS");
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

async function runNitradoAdminLogsTests() {
  const may26Text = [
    "******************************************************************************",
    "AdminLog started on 2026-05-26 at 07:02:39",
    "07:03:01 | Player \"Miguel_gls15\" (id=N0EdVAsEZ49dRUtvQnfNtSMGGd6fMWIkGMFfxszjsjM= pos=<6435.7, 8100.1, 333.0>) is connecting",
    "07:03:02 | Player \"Miguel_gls15\" (id=N0EdVAsEZ49dRUtvQnfNtSMGGd6fMWIkGMFfxszjsjM= pos=<6435.7, 8100.1, 333.0>) is connected",
    "07:13:02 | Player \"Miguel_gls15\" (id=N0EdVAsEZ49dRUtvQnfNtSMGGd6fMWIkGMFfxszjsjM= pos=<6435.7, 8100.1, 333.0>) has been disconnected",
  ].join("\n");
  const shapes = [
    { admin_logs: may26Text },
    { logs: may26Text },
    { data: { admin_logs: may26Text } },
    { data: { logs: may26Text.split("\n") } },
    { logs: may26Text.split("\n").map((message) => ({ message })) },
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const payload of shapes) {
      globalThis.fetch = mockNitradoFetch({
        logFiles: [],
        seekFails: true,
        downloadSucceeds: false,
        admText: may26Text,
        adminLogsPayload: payload,
      });
      const result = await readNitradoAdminLogs("18765761", "unit-token");
      assert.equal(result.ok, true);
      assert.equal(result.source, "admin_logs");
      assert.equal(result.inferredAdmFileName, "DayZServer_PS4_x64_2026-05-26_07-02-39.ADM");
      assert.equal(result.latestStartedAt, "2026-05-26T07:02:39.000Z");
      assert.equal(result.entries.some((line) => line.includes("Miguel_gls15")), true);
    }

    globalThis.fetch = mockNitradoFetch({
      logFiles: [],
      seekFails: true,
      downloadSucceeds: false,
      admText: may26Text,
      adminLogsPayload: { unexpected: { nested: "not an ADM log" } },
    });
    const unknown = await readNitradoAdminLogs("18765761", "unit-token");
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errorCode, "NITRADO_ADMIN_LOGS_NO_ADM_TEXT");

    globalThis.fetch = mockNitradoFetch({
      logFiles: ["dayzps/config/DayZServer_PS4_x64_2026-05-26_07-02-39.ADM"],
      seekFails: true,
      downloadSucceeds: false,
      admText: may26Text,
      adminLogsPayload: { admin_logs: may26Text },
    });
    const batch = await fetchReadableNitradoAdmFiles("unit-token", "18765761", {
      mode: "sample",
      maxFiles: 1,
      previousLatestAdmFileName: "DayZServer_PS4_x64_2026-05-26_06-01-40.ADM",
    });
    assert.equal(batch.files.length, 1);
    assert.equal(batch.files[0]?.name, "DayZServer_PS4_x64_2026-05-26_07-02-39.ADM");
    assert.equal(batch.files[0]?.path, "admin_logs/current/DayZServer_PS4_x64_2026-05-26_07-02-39.ADM");
    assert.equal(batch.files[0]?.readableRouteUsed, "nitrado_admin_logs");
    assert.equal(batch.readErrors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runNitradoReadFallbackTests() {
  const latestAdm = "DayZServer_PS4_x64_2026-05-20_08-02-52.ADM";
  const oldAdm = "DayZServer_PS4_x64_2026-05-19_21-01-43.ADM";
  const admPath = `dayzps/config/${latestAdm}`;
  const admText = [
    "AdminLog started on 2026-05-20 at 08:02:52",
    "08:03:01 | Player \"TempoGreens\" is connected",
  ].join("\n");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = mockNitradoFetch({
      logFiles: [`dayzps/config/${oldAdm}`, admPath],
      seekFails: true,
      downloadSucceeds: true,
      admText,
    });
    const batch = await fetchReadableNitradoAdmFiles("unit-token", "17428528", {
      mode: "sample",
      maxFiles: 2,
      previousLatestAdmFileName: oldAdm,
    });
    assert.equal(batch.newestAdmFileName, latestAdm);
    assert.equal(batch.candidates.at(-1)?.name, latestAdm);
    assert.equal(batch.files.some((file) => file.name === latestAdm), true);
    const directRead = await readAdmFileTextWithFallback({
      token: "unit-token",
      serviceId: "17428528",
      fileName: latestAdm,
      originalPath: latestAdm,
      username: "gameserver-unit",
      options: { mode: "full" },
    });
    assert.equal(directRead.ok, true);
    assert.equal(directRead.readMethod, "download_fallback");
    assert.equal(directRead.seekAttempted, true);
    assert.equal(directRead.seekOk, false);
    assert.equal(directRead.downloadAttempted, true);
    assert.equal(directRead.downloadOk, true);
    assert.equal(directRead.selectedPath, `dayzps/config/${latestAdm}`);
    assert.equal(directRead.text?.includes("AdminLog started on 2026-05-20 at 08:02:52"), true);
    assert.equal(directRead.readAttempts.some((attempt) => attempt.requestUrlPathOnly.includes(`file=dayzps/config/${latestAdm}`)), true);
    assert.equal(directRead.readAttempts.some((attempt) => attempt.requestUrlPathOnly.includes("dayzps%2Fconfig")), false);

    const debug = await debugNitradoAdmFileDiscovery("unit-token", "17428528", {
      knownLatestFileName: latestAdm,
      sampleLimit: 2,
    });
    const selected = debug.selected_newest_available;
    assert.equal(selected?.name, latestAdm);
    assert.equal(debug.selected_newest_readable?.name, latestAdm);
    assert.equal(selected?.seek_sample_attempted, true);
    assert.equal(selected?.seek_sample_error, "Nitrado seek request failed");
    assert.equal(selected?.download_fallback_attempted, true);
    assert.equal(selected?.download_fallback_error, null);
    assert.equal(selected?.selected_read_method, "download_fallback");
    assert.equal(selected?.selected_successful_path, `dayzps/config/${latestAdm}`);
    assert.equal(selected?.attempted_paths.some((attempt) => attempt.path === `dayzps/config/${latestAdm}` && attempt.fileFetchOk), true);
    assert.equal(selected?.first_lines_preview[0], "AdminLog started on 2026-05-20 at 08:02:52");
    const debugJson = JSON.stringify(debug);
    assert.equal(debugJson.includes("files.dzn.test"), false);
    assert.equal(debugJson.includes("secret-download-token"), false);

    globalThis.fetch = mockNitradoFetch({
      logFiles: [admPath],
      seekFails: true,
      downloadSucceeds: true,
      admText,
      acceptedDownloadPath: `/dayzps/config/${latestAdm}`,
    });
    const slashRead = await readAdmFileTextWithFallback({
      token: "unit-token",
      serviceId: "17428528",
      fileName: latestAdm,
      originalPath: latestAdm,
      username: "gameserver-unit",
      options: { mode: "full" },
    });
    assert.equal(slashRead.ok, true);
    assert.equal(slashRead.selectedPath, `/dayzps/config/${latestAdm}`);

    globalThis.fetch = mockNitradoFetch({
      logFiles: [admPath],
      seekFails: true,
      downloadSucceeds: true,
      admText,
      acceptedDownloadPath: `games/gameserver-unit/noftp/dayzps/config/${latestAdm}`,
    });
    const noftpRead = await readAdmFileTextWithFallback({
      token: "unit-token",
      serviceId: "17428528",
      fileName: latestAdm,
      originalPath: admPath,
      username: "gameserver-unit",
      options: { mode: "full", maxPathVariants: 4 },
    });
    assert.equal(noftpRead.ok, true);
    assert.equal(noftpRead.selectedPath, `games/gameserver-unit/noftp/dayzps/config/${latestAdm}`);

    const noftpBatch = await fetchReadableNitradoAdmFiles("unit-token", "17428528", {
      mode: "sample",
      maxFiles: 1,
      maxPathVariants: 1,
      currentFileMaxPathVariants: 4,
    });
    assert.equal(noftpBatch.files.some((file) => file.name === latestAdm), true);
    assert.equal(noftpBatch.files[0]?.path, `games/gameserver-unit/noftp/dayzps/config/${latestAdm}`);

    const resetFiles = [
      "DayZServer_PS4_x64_2026-05-31_17-01-47.ADM",
      "DayZServer_PS4_x64_2026-05-31_18-02-38.ADM",
      "DayZServer_PS4_x64_2026-05-31_19-01-29.ADM",
    ];
    const richIntermediateAdm = resetFiles[1];
    const richIntermediateText = [
      "AdminLog started on 2026-05-31 at 18:02:38",
      '18:12:01 | Player "Victim" (DEAD) (id=victim-id pos=<1, 1, 1>) killed by Player "Killer" (id=killer-id pos=<2, 2, 2>) with M4-A1 from 41 meters',
      '18:12:04 | Player "Victim" (id=victim-id pos=<1, 1, 1>) has been disconnected',
    ].join("\n");
    globalThis.fetch = mockNitradoFetch({
      logFiles: resetFiles.map((name) => `dayzps/config/${name}`),
      seekFails: true,
      downloadSucceeds: true,
      admText: richIntermediateText,
      acceptedDownloadPath: `games/gameserver-unit/noftp/dayzps/config/${richIntermediateAdm}`,
      adminLogsPayload: { status: "success", data: { logs: {} } },
    });
    const intermediateBatch = await fetchReadableNitradoAdmFiles("unit-token", "18765761", {
      mode: "full",
      preferredAdmFileName: richIntermediateAdm,
      preferredAdmPath: `dayzps/config/${richIntermediateAdm}`,
      directPreferredFirst: false,
      adminLogsFirst: false,
      maxFiles: 1,
      maxPathVariants: 1,
      currentFileMaxPathVariants: 1,
    });
    assert.equal(intermediateBatch.files[0]?.name, richIntermediateAdm);
    assert.equal(intermediateBatch.files[0]?.path, `games/gameserver-unit/noftp/dayzps/config/${richIntermediateAdm}`);
    assert.equal(intermediateBatch.candidates.map((file) => file.name).join(","), resetFiles.join(","));
    assert.equal(intermediateBatch.files[0]?.lines.some((line) => line.includes("killed by Player")), true);

    globalThis.fetch = mockNitradoFetch({
      logFiles: [admPath],
      seekFails: true,
      seekSucceedsWithoutRaw: true,
      downloadSucceeds: false,
      admText,
    });
    const noRawSeekRead = await readAdmFileTextWithFallback({
      token: "unit-token",
      serviceId: "17428528",
      fileName: latestAdm,
      originalPath: admPath,
      username: "gameserver-unit",
      options: { mode: "full", trySeekWithoutRaw: true },
    });
    assert.equal(noRawSeekRead.ok, true);
    assert.equal(noRawSeekRead.readMethod, "seek");
    assert.equal(noRawSeekRead.readAttempts.some((attempt) => attempt.diagnosticMethod === "seek_no_raw" && attempt.sampleReadSucceeded), true);

    globalThis.fetch = mockNitradoFetch({
      logFiles: [admPath],
      seekFails: true,
      downloadSucceeds: true,
      admText,
      directDownloadText: true,
    });
    const directTextRead = await readAdmFileTextWithFallback({
      token: "unit-token",
      serviceId: "17428528",
      fileName: latestAdm,
      originalPath: admPath,
      username: "gameserver-unit",
      options: { mode: "full" },
    });
    assert.equal(directTextRead.ok, true);
    assert.equal(directTextRead.readMethod, "download_fallback");
    assert.equal(directTextRead.downloadOk, true);
    assert.equal(directTextRead.text?.includes("AdminLog started on 2026-05-20 at 08:02:52"), true);

    globalThis.fetch = mockNitradoFetch({
      logFiles: [admPath],
      seekFails: true,
      downloadSucceeds: false,
      admText,
    });
    const unreadableBatch = await fetchReadableNitradoAdmFiles("unit-token", "17428528", {
      mode: "sample",
      maxFiles: 1,
    });
    assert.equal(unreadableBatch.newestAdmFileName, latestAdm);
    assert.equal(unreadableBatch.files.length, 0);
    assert.equal(unreadableBatch.readErrors.some((error) => error.includes(latestAdm)), true);
    assert.equal(typeof unreadableBatch.readError, "string");
    const unreadableDebug = await debugNitradoAdmFileDiscovery("unit-token", "17428528", {
      knownLatestFileName: latestAdm,
      sampleLimit: 1,
    });
    assert.equal(unreadableDebug.selected_newest_available?.name, latestAdm);
    assert.equal(unreadableDebug.selected_newest_readable, null);
    assert.equal(unreadableDebug.selected_newest_available?.download_fallback_attempted, true);
    assert.equal(unreadableDebug.problem_flags.includes("newest_available_not_readable"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function mockNitradoFetch(options: {
  logFiles: string[];
  seekFails: boolean;
  seekSucceedsWithoutRaw?: boolean;
  downloadSucceeds: boolean;
  admText: string;
  acceptedSeekPath?: string;
  acceptedDownloadPath?: string;
  directDownloadText?: boolean;
  adminLogsPayload?: unknown;
  adminLogsStatus?: number;
}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.hostname === "api.nitrado.net" && url.pathname.endsWith("/gameservers/admin_logs")) {
      const status = options.adminLogsStatus ?? (options.adminLogsPayload === undefined ? 404 : 200);
      if (typeof options.adminLogsPayload === "string") {
        return new Response(options.adminLogsPayload, {
          status,
          headers: { "content-type": "text/plain" },
        });
      }
      return jsonResponse(options.adminLogsPayload ?? { error: "admin logs unavailable" }, status);
    }
    if (url.hostname === "api.nitrado.net" && url.pathname.endsWith("/gameservers") && !url.pathname.includes("file_server")) {
      return jsonResponse({
        data: {
          gameserver: {
            username: "gameserver-unit",
            game: "dayzps",
            name: "Pandora Test",
            game_specific: {
              log_files: options.logFiles,
            },
          },
        },
      });
    }
    if (url.hostname === "api.nitrado.net" && url.pathname.includes("/file_server/list")) {
      return jsonResponse({ data: { entries: [] } });
    }
    if (url.hostname === "api.nitrado.net" && url.pathname.includes("/file_server/seek")) {
      const requestedPath = url.searchParams.get("file") ?? "";
      const rawMode = url.searchParams.get("mode") === "raw";
      const acceptedPath = options.acceptedSeekPath ?? null;
      const pathAccepted = acceptedPath ? requestedPath === acceptedPath : requestedPath.includes("/");
      if (options.seekSucceedsWithoutRaw && !rawMode && pathAccepted) {
        return new Response(options.admText, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      if (options.seekFails) throw new Error("seek unavailable");
      return jsonResponse({ data: { url: "https://files.dzn.test/adm-download", token: "secret-download-token" } });
    }
    if (url.hostname === "api.nitrado.net" && url.pathname.includes("/file_server/download")) {
      const requestedPath = url.searchParams.get("file") ?? "";
      const acceptedPath = options.acceptedDownloadPath ?? null;
      const pathAccepted = acceptedPath ? requestedPath === acceptedPath : requestedPath.includes("/");
      if (!options.downloadSucceeds || !pathAccepted) return jsonResponse({ error: "download failed" }, 404);
      if (options.directDownloadText) {
        return new Response(options.admText, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return jsonResponse({ data: { url: "https://files.dzn.test/adm-download", token: "secret-download-token" } });
    }
    if (url.hostname === "files.dzn.test") {
      if (!options.downloadSucceeds) return new Response("forbidden", { status: 403 });
      return new Response(options.admText, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    return jsonResponse({ data: {} }, 404);
  }) as typeof fetch;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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
