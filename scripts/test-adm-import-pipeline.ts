import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createAdmImportJobForServer,
  createScheduledAdmImportJobForServer,
  cancelAdmImportLineJobForServer,
  finishAdmImportLineJobForServer,
  getAdmImportJobProgressForServer,
  getLatestAdmImportJobProgressForFilename,
  getRecentAdmSyncEvents,
  importAdmFilesForServer,
  importAdmTextForServer,
  importReadableAdmLinesIntoDatabase,
  isAdmFileNewerThan,
  processPendingAdmImportJobs,
  processAdmImportJobLineChunk,
  processNextAdmImportJobChunk,
  previewManualAdmText,
  processRecentAdmBuildReparse,
  startAdmImportLineJobForServer,
  type AdmSyncContext,
  buildAdmBackfillPlan,
} from "../functions/_lib/adm-sync";
import { parseAdmLines } from "../functions/_lib/adm-parser";
import { classifyParsedBuildEvent, rebuildServerBuildStats } from "../functions/_lib/build-events";
import type { Env } from "../functions/_lib/types";

const fixtureName = "DayZServer_PS4_x64_2026-05-19_16-01-55.ADM";
const fixtureLines = readFileSync(`scripts/fixtures/${fixtureName}`, "utf8").split(/\r?\n/).filter(Boolean);
const latestFixtureName = "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM";
const latestFixtureLines = readFileSync(`scripts/fixtures/${latestFixtureName}`, "utf8").split(/\r?\n/).filter(Boolean);
const bulkFixtureNames = [
  "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM",
  "DayZServer_PS4_x64_2026-05-20_09-01-27.ADM",
  "DayZServer_PS4_x64_2026-05-20_10-02-17.ADM",
] as const;
const bulkFixtureFiles = bulkFixtureNames.map((filename) => ({
  filename,
  admText: readFileSync(`scripts/fixtures/${filename}`, "utf8"),
}));
const largeFixtureName = "DayZServer_PS4_x64_2026-05-20_12-02-31.ADM";
const largeFixtureText = readFileSync(`scripts/fixtures/${largeFixtureName}`, "utf8");
const largeFixtureLines = largeFixtureText.split(/\r?\n/).filter(Boolean);
const linkedServerId = "fixture-linked-server";
const guildId = "fixture-guild";
const nitradoServiceId = "fixture-service";
const demonchaserFixtureName = "DayZServer_PS4_x64_2026-05-20_09-01-27.ADM";
const demonchaserKillLine = '00:58 | Player "Demonchaser69420" (DEAD) (id=PLZk8nv5S7Wc90LP6G_b7J3eLJVZqgjF5v74mmBUXws= pos=<6427.9, 8104.8, 333.0>) killed by Player "xAKA-MINI_KickAs" (id=6UDi_1JJT6kT7ZWKpdbggtlbhidMn3_vtINTDfoBY9Q= pos=<6410.2, 8089.4, 339.5>) with M4-A1 from 24.38 meters';
const context: AdmSyncContext = {
  linkedServerId,
  nitradoServiceId,
  serverName: "Fixture Server",
  admFileName: fixtureName,
  syncRunId: "fixture-sync-run",
};

async function main() {
  const manualEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/manual-import.ts", "utf8");
  const previewEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/parse-preview.ts", "utf8");
  const bulkEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/bulk-import.ts", "utf8");
  const forceLatestEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/force-latest.ts", "utf8");
  const backfillEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/backfill.ts", "utf8");
  const automationStatusEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/automation-status.ts", "utf8");
  const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
  const chunkEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/import-job/chunk.ts", "utf8");
  const statusEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/import-job/status.ts", "utf8");
  const latestEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/import-job/latest.ts", "utf8");
  const continueEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/import-job/continue.ts", "utf8");
  const cancelEndpointSource = readFileSync("functions/api/servers/[serverId]/adm/import-job/cancel.ts", "utf8");
  const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
  const admAutomationCheckSource = readFileSync("scripts/check-adm-automation.ts", "utf8");
  assert.match(manualEndpointSource, /requireServerOwnerOrDznAdmin/);
  assert.match(manualEndpointSource, /getSessionUser/);
  assert.match(manualEndpointSource, /ADM text is required/);
  assert.match(manualEndpointSource, /error_code/);
  assert.match(manualEndpointSource, /manual_adm_import_failed/);
  assert.match(previewEndpointSource, /previewManualAdmText/);
  assert.match(previewEndpointSource, /error_code/);
  assert.match(bulkEndpointSource, /importAdmFilesForServer/);
  assert.match(bulkEndpointSource, /multipart\/form-data/);
  assert.match(bulkEndpointSource, /requireServerOwnerOrDznAdmin/);
  assert.match(bulkEndpointSource, /chunked_import_required/);
  assert.match(bulkEndpointSource, /ADM file imports must use chunked import jobs/);
  assert.match(dashboardSource, /startAdmImportJob/);
  assert.match(dashboardSource, /sendAdmImportJobChunk/);
  assert.match(dashboardSource, /finishAdmImportJob/);
  assert.match(dashboardSource, /ADM_IMPORT_UPLOAD_CHUNK_SIZE = 10/);
  assert.doesNotMatch(dashboardSource, /Chunks"\s+value=\{[^}]*"Fast path"/);
  assert.match(dashboardSource, /for \(const \[index, file\] of files\.entries\(\)\)/);
  assert.match(dashboardSource, /Retry this file/);
  assert.match(dashboardSource, /ADM_IMPORT_RETRY_CHUNK_SIZES = \[5, 1\]/);
  assert.match(dashboardSource, /sendAdmImportChunkWithFallback/);
  assert.match(dashboardSource, /Lines Detected/);
  assert.match(dashboardSource, /Preview Kills/);
  assert.match(dashboardSource, /Failed Endpoint/);
  assert.match(dashboardSource, /First Failed Line/);
  assert.match(dashboardSource, /completed_with_warnings/);
  assert.match(dashboardSource, /makeWarningBulkAdmFileResultFromProgress/);
  assert.match(dashboardSource, /makeProcessingBulkAdmFileResultFromJob/);
  assert.match(dashboardSource, /mergeActiveAdmImportJobIntoBulkResult/);
  assert.match(dashboardSource, /syncStatusActiveAdmImportJob/);
  assert.match(dashboardSource, /ADM_IMPORT_JOB_POLL_INTERVAL_MS = 3000/);
  assert.match(dashboardSource, /Files Processing/);
  assert.match(dashboardSource, /Continue Import/);
  assert.match(dashboardSource, /Pause Import/);
  assert.match(dashboardSource, /Resume Import/);
  assert.match(dashboardSource, /Cancel Import/);
  assert.match(dashboardSource, /runServerSideAdmImportJobToCompletion/);
  assert.match(dashboardSource, /ADM_CHUNK_RUNNER_DELAY_MS = 300/);
  assert.match(dashboardSource, /ADM_CHUNK_RUNNER_RATE_LIMIT_DELAY_MS = 1500/);
  assert.match(dashboardSource, /chunks\/min/);
  assert.match(dashboardSource, /estimatedRemainingSeconds/);
  assert.match(dashboardSource, /getSafeAdmChunkProgressPercent/);
  assert.match(dashboardSource, /display_current_chunk/);
  assert.match(dashboardSource, /getAdmImportJobStatus/);
  assert.match(dashboardSource, /getLatestAdmImportJob/);
  assert.match(dashboardSource, /Job Status/);
  assert.match(dashboardSource, /Finish Status/);
  assert.match(dashboardSource, /refreshDashboardAfterManualAdmImport\(\)/);
  assert.match(dashboardSource, /Bulk ADM Import Summary/);
  assert.match(dashboardSource, /Previous Import Attempts/);
  assert.match(dashboardSource, /Import Diagnostics/);
  assert.match(dashboardSource, /Dashboard totals updated/);
  assert.match(dashboardSource, /Already imported - skipped by dedupe/);
  assert.match(dashboardSource, /ADM import completed\. Stats and feeds updated\./);
  assert.match(dashboardSource, /makeDashboardTotalsSnapshot/);
  assert.doesNotMatch(dashboardSource, /open=\{result\.files\.length <= 3\}/);
  assert.match(forceLatestEndpointSource, /createScheduledAdmImportJobForServer/);
  assert.match(forceLatestEndpointSource, /requireServerOwnerOrDznAdmin/);
  assert.match(backfillEndpointSource, /planAdmBackfillJobsForServer/);
  assert.match(backfillEndpointSource, /requireServerOwnerOrDznAdmin/);
  assert.match(chunkEndpointSource, /requestDetails/);
  assert.match(chunkEndpointSource, /firstLinePreview/);
  assert.match(statusEndpointSource, /getAdmImportJobProgressForServer/);
  assert.match(latestEndpointSource, /getLatestAdmImportJobProgressForFilename/);
  assert.match(continueEndpointSource, /processNextAdmImportJobChunk/);
  assert.match(cancelEndpointSource, /cancelAdmImportLineJobForServer/);
  assert.match(dashboardSource, /Chunk Import Job/);
  assert.match(dashboardSource, /Processing latest ADM in chunks/);
  assert.match(dashboardSource, /ADM Backfill Status/);
  assert.match(dashboardSource, /Backfill Missing ADM Now/);
  assert.match(dashboardSource, /Verify ADM Automation/);
  assert.match(dashboardSource, /Dashboard Data Health/);
  assert.match(dashboardSource, /lastGoodSyncStatus/);
  assert.match(dashboardSource, /lastGoodBilling/);
  assert.match(dashboardSource, /Promise\.allSettled/);
  assert.match(dashboardSource, /adm_backfill_status/);
  const packageSource = readFileSync("package.json", "utf8");
  assert.match(packageSource, /"check:adm-backfill": "tsx scripts\/check-adm-backfill\.ts"/);
  assert.match(packageSource, /"check:adm-automation": "tsx scripts\/check-adm-automation\.ts"/);
  assert.match(admSyncSource, /SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK = 1/);
  assert.match(admSyncSource, /processAdmImportJobsUntilBudget/);
  assert.match(admSyncSource, /pendingJobWorkCompleted/);
  assert.match(admSyncSource, /planAdmBackfillJobsForServer\(env, selected\.user_id, selected\.id/);
  assert.match(admSyncSource, /processImmediately: false/);
  assert.equal(admSyncSource.includes("prioritizedLiveCurrentJobKey"), false);
  assert.match(admSyncSource, /preliminaryPlan\.missingFiles/);
  assert.match(admSyncSource, /status IN \('queued', 'failed_retryable'\)/);
  assert.match(admSyncSource, /COALESCE\(updated_at, created_at\) < \?/);
  assert.match(admSyncSource, /chunk_size = CASE/);
  assert.match(admSyncSource, /SCHEDULED_ADM_IMPORT_CHUNK_SIZE = 50/);
  assert.match(admSyncSource, /SCHEDULED_ADM_IMPORT_STALE_MS = 2 \* 60 \* 1000/);
  assert.match(admSyncSource, /getNewestAdmFileStateForSyncState/);
  assert.match(admSyncSource, /currentFileMaxPathVariants/);
  assert.match(admSyncSource, /trySeekWithoutRaw/);
  assert.match(admSyncSource, /lastProcessedFile = rowCompleted \? row\.filename : existingState\?\.last_processed_file/);
  assert.match(admSyncSource, /row\.source === SCHEDULED_ADM_IMPORT_SOURCE \? "scheduled_chunked_import" : "manual_chunked_import"/);
  assert.match(admSyncSource, /type = values\.source === SCHEDULED_ADM_IMPORT_SOURCE/);
  assert.match(admSyncSource, /already_processed/);
  assert.match(admSyncSource, /chunk_count_mismatch/);
  assert.match(admSyncSource, /cancelAdmImportLineJobForServer/);
  assert.match(automationStatusEndpointSource, /requireServerOwnerOrDznAdmin/);
  assert.match(automationStatusEndpointSource, /problem_flags/);
  assert.match(automationStatusEndpointSource, /cron_healthy/);
  assert.match(automationStatusEndpointSource, /missing_files/);
  assert.match(admAutomationCheckSource, /DZN ADM Automation Check/);
  assert.match(admAutomationCheckSource, /problem flags/);

  const backfillFixtureNames = [
    "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM",
    "DayZServer_PS4_x64_2026-05-20_09-01-27.ADM",
    "DayZServer_PS4_x64_2026-05-20_10-02-17.ADM",
    "DayZServer_PS4_x64_2026-05-20_12-02-31.ADM",
  ];
  const backfillPlan = buildAdmBackfillPlan({
    files: backfillFixtureNames.map((name) => ({ name, readable: true })),
    handledFilenames: [],
    existingJobs: [],
    planKey: "partner",
    nowMs: Date.UTC(2026, 4, 20, 13, 0, 0),
    maxJobsToCreate: 3,
  });
  assert.deepEqual(backfillPlan.missingFiles, backfillFixtureNames);
  assert.deepEqual(backfillPlan.createFiles, backfillFixtureNames.slice(0, 3));
  assert.equal(backfillPlan.oldestMissingFile, "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM");
  assert.equal(backfillPlan.newestMissingFile, "DayZServer_PS4_x64_2026-05-20_12-02-31.ADM");

  const postResetFiles = [
    "DayZServer_PS4_x64_2026-05-31_16-02-03.ADM",
    "DayZServer_PS4_x64_2026-05-31_17-01-47.ADM",
    "DayZServer_PS4_x64_2026-05-31_18-02-38.ADM",
    "DayZServer_PS4_x64_2026-05-31_19-01-29.ADM",
  ];
  const postResetPlan = buildAdmBackfillPlan({
    files: postResetFiles.map((name) => ({ name, readable: true })),
    handledFilenames: [postResetFiles[0]],
    existingJobs: [],
    planKey: "partner",
    nowMs: Date.UTC(2026, 4, 31, 20, 0, 0),
    maxJobsToCreate: 1,
  });
  assert.deepEqual(postResetPlan.missingFiles, postResetFiles.slice(1));
  assert.deepEqual(postResetPlan.createFiles, [postResetFiles[1]]);
  assert.equal(postResetPlan.oldestMissingFile, postResetFiles[1]);
  assert.equal(postResetPlan.newestMissingFile, postResetFiles[3]);

  const manualDedupeBackfillPlan = buildAdmBackfillPlan({
    files: backfillFixtureNames.map((name) => ({ name, readable: true })),
    handledFilenames: [backfillFixtureNames[0]],
    existingJobs: [],
    planKey: "starter",
    nowMs: Date.UTC(2026, 4, 20, 13, 0, 0),
  });
  assert.equal(manualDedupeBackfillPlan.skippedAlreadyImported.includes(backfillFixtureNames[0]), true);
  assert.deepEqual(manualDedupeBackfillPlan.createFiles, [backfillFixtureNames[1]]);

  const activeBackfillPlan = buildAdmBackfillPlan({
    files: backfillFixtureNames.map((name) => ({ name, readable: true })),
    handledFilenames: [],
    existingJobs: [{ filename: backfillFixtureNames[0], status: "queued", source: "scheduled_nitrado" }],
    planKey: "partner",
    nowMs: Date.UTC(2026, 4, 20, 13, 0, 0),
    maxJobsToCreate: 3,
  });
  assert.deepEqual(activeBackfillPlan.createFiles, []);
  assert.equal(activeBackfillPlan.queuedFiles.includes(backfillFixtureNames[0]), true);

  const unreadableBackfillPlan = buildAdmBackfillPlan({
    files: [
      { name: backfillFixtureNames[0], readable: false, readError: "Nitrado download failed" },
      { name: backfillFixtureNames[1], readable: true },
      { name: backfillFixtureNames[2], readable: true },
    ],
    handledFilenames: [],
    existingJobs: [],
    planKey: "partner",
    nowMs: Date.UTC(2026, 4, 20, 13, 0, 0),
    maxJobsToCreate: 3,
  });
  assert.equal(unreadableBackfillPlan.unreadableFiles[0]?.filename, backfillFixtureNames[0]);
  assert.deepEqual(unreadableBackfillPlan.createFiles, [backfillFixtureNames[1], backfillFixtureNames[2]]);

  const successDb = new MemoryD1();
  const successResult = await importReadableAdmLinesIntoDatabase(makeEnv(successDb), {
    context,
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    publicServerName: "Fixture Server",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });

  assert.equal(successResult.status, "completed");
  assert.equal(successDb.killEvents.length, 10);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_suicide").length, 2);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_died_stats").length, 1);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_hit").length, 3);
  assert.equal(successDb.playerEvents.filter((event) => event.event_type === "player_hit").every((event) => event.player_name !== null), true);
  assert.deepEqual(countBy(successDb.killEvents, "killer_name"), {
    mustard_coffer74: 5,
    Uractuallybadzzz: 4,
    "xAKA-MINI_KickAs": 1,
  });
  assert.deepEqual(countBy(successDb.killEvents, "victim_name"), {
    mustard_coffer74: 4,
    Uractuallybadzzz: 5,
    "xAKA-MINI_KickAs": 1,
  });
  const longestKill = successDb.killEvents.reduce((best, row) => (Number(row.distance) > Number(best.distance) ? row : best), successDb.killEvents[0]);
  assert.equal(longestKill.killer_name, "mustard_coffer74");
  assert.equal(longestKill.victim_name, "Uractuallybadzzz");
  assert.equal(longestKill.distance, 48.5404);
  assert.equal(successDb.serverStats.get(linkedServerId)?.total_kills, 10);
  assert.equal(successDb.serverStats.get(linkedServerId)?.total_deaths, 13);
  assert.equal(successResult.cursorBefore, 0);
  assert.equal(successResult.cursorAfter, 25);
  assert.equal(successDb.admSyncState.get(linkedServerId)?.last_processed_line, 25);
  assert.match(String(successDb.admSyncState.get(linkedServerId)?.last_processed_adm_line_hash ?? ""), /^[a-f0-9]{40}$/);
  assert.equal(successDb.admSyncState.get(linkedServerId)?.last_processed_adm_line_text_preview, fixtureLines[24].slice(0, 160));
  assert.equal(successResult.report.cursorValidationStatus, "new_file");
  assert.equal(successResult.report.rawKilledByLinesFound, 10);
  assert.equal(successResult.report.parsedPvpKills, 10);
  assert.equal(successResult.report.writtenKills, 10);
  assert.equal(successResult.report.duplicateSkips, 0);
  assert.equal(successResult.report.skippedDeadHitLines, 3);
  assert.equal(successResult.report.publicCacheUpdated, true);
  assert.equal(successResult.report.discordQueuesCreated > 0, true);
  assert.equal(successDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(successDb.automationJobs.length > 0, true);

  const latestDb = new MemoryD1();
  const latestLinkedServerId = "latest-fixture-linked-server";
  const latestGuildId = "latest-fixture-guild";
  const latestResult = await importReadableAdmLinesIntoDatabase(makeEnv(latestDb), {
    context: {
      ...context,
      linkedServerId: latestLinkedServerId,
      admFileName: latestFixtureName,
      syncRunId: "latest-fixture-sync-run",
    },
    lines: latestFixtureLines,
    guildId: latestGuildId,
    planKey: "partner",
    publicServerName: "Latest Fixture Server",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(latestResult.status, "completed");
  assert.equal(latestDb.killEvents.filter((event) => event.linked_server_id === latestLinkedServerId).length, 5);
  assert.equal(latestDb.playerEvents.filter((event) => event.linked_server_id === latestLinkedServerId && event.event_type === "player_connected").length, 8);
  assert.equal(latestDb.playerEvents.filter((event) => event.linked_server_id === latestLinkedServerId && event.event_type === "player_disconnected").length, 1);
  assert.equal(latestDb.playerEvents.filter((event) => event.linked_server_id === latestLinkedServerId && event.event_type === "player_hit").length, 74);
  assert.equal(latestDb.serverStats.get(latestLinkedServerId)?.total_kills, 5);
  assert.equal(latestResult.report.rawKilledByLinesFound, 5);
  assert.equal(latestResult.report.parsedPvpKills, 5);
  assert.equal(latestResult.report.writtenKills, 5);
  assert.equal(latestResult.report.cursorBefore, 0);
  assert.equal(latestResult.report.cursorAfter, latestFixtureLines.length);
  assert.equal(latestResult.report.publicCacheUpdated, true);
  assert.equal(latestDb.serverPublicCache.get(latestGuildId)?.last_adm_update_at !== null, true);

  const manualDb = new MemoryD1();
  const manualText = fixtureLines.join("\n");
  const manualResult = await importAdmTextForServer(makeEnv(manualDb), {
    linkedServerId,
    filename: fixtureName,
    admText: manualText,
    source: "manual_paste",
  });
  assert.equal(manualResult.ok, true);
  assert.equal(manualResult.source, "manual_paste");
  assert.equal(manualResult.parsed_kills, 10);
  assert.equal(manualResult.written_kills, 10);
  assert.match(manualResult.import_report_id, /^[0-9a-f-]{36}$/);
  assert.equal(manualResult.import_report.importSource, "manual_paste");
  assert.equal(manualResult.import_report.admFileName, fixtureName);
  assert.equal(manualResult.import_report.parsedJoins, 1);
  assert.equal(manualResult.import_report.parsedPlayerlistSnapshots, 1);
  assert.equal(manualResult.public_cache_updated, true);
  assert.equal(manualResult.discord_jobs_queued > 0, true);
  assert.equal(manualDb.killEvents.length, 10);
  assert.equal(manualDb.syncRuns.at(-1)?.trigger_type, "manual_paste");
  const manualRunPayload = JSON.parse(String(manualDb.syncRuns.at(-1)?.message ?? "{}")) as Record<string, unknown>;
  assert.equal(manualRunPayload.type, "manual_adm_import");
  assert.equal(manualRunPayload.filename, fixtureName);
  assert.equal(manualRunPayload.parsed_kills, 10);
  assert.equal(manualRunPayload.written_kills, 10);
  const repeatedManualResult = await importAdmTextForServer(makeEnv(manualDb), {
    linkedServerId,
    filename: fixtureName,
    admText: manualText,
    source: "manual_paste",
  });
  assert.equal(manualDb.killEvents.length, 10);
  assert.equal(repeatedManualResult.parsed_kills, 10);
  assert.equal(repeatedManualResult.written_kills, 0);
  assert.equal(repeatedManualResult.duplicate_skips > 0, true);

  const singleLinePreview = previewManualAdmText({
    filename: demonchaserFixtureName,
    admText: demonchaserKillLine,
  });
  assert.equal(singleLinePreview.ok, true);
  assert.equal(singleLinePreview.raw_lines, 1);
  assert.equal(singleLinePreview.raw_kill_lines_found, 1);
  assert.equal(singleLinePreview.parsed_kills, 1);
  assert.equal(singleLinePreview.kill_previews[0]?.victim_name, "Demonchaser69420");
  assert.equal(singleLinePreview.kill_previews[0]?.killer_name, "xAKA-MINI_KickAs");
  assert.equal(singleLinePreview.kill_previews[0]?.weapon, "M4-A1");
  assert.equal(singleLinePreview.kill_previews[0]?.distance, 24.38);

  const singleLineDb = new MemoryD1();
  const singleLineResult = await importAdmTextForServer(makeEnv(singleLineDb), {
    linkedServerId,
    filename: demonchaserFixtureName,
    admText: demonchaserKillLine,
    source: "manual_paste",
  });
  assert.equal(singleLineResult.ok, true);
  assert.equal(singleLineResult.parsed_kills, 1);
  assert.equal(singleLineResult.written_kills, 1);
  assert.equal(singleLineResult.import_report.importSource, "manual_paste");
  assert.equal(singleLineDb.killEvents.length, 1);
  assert.equal(singleLineDb.killEvents[0]?.victim_name, "Demonchaser69420");
  assert.equal(singleLineDb.killEvents[0]?.killer_name, "xAKA-MINI_KickAs");
  assert.equal(singleLineDb.killEvents[0]?.weapon, "M4-A1");
  assert.equal(singleLineDb.killEvents[0]?.distance, 24.38);
  assert.equal(singleLineDb.serverStats.get(linkedServerId)?.total_kills, 1);
  assert.equal(singleLineDb.serverStats.get(linkedServerId)?.total_deaths, 1);
  assert.equal(singleLineDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(singleLineDb.automationJobs.length > 0, true);
  const singleLineRecentEvents = await getRecentAdmSyncEvents(makeEnv(singleLineDb), "fixture-user", linkedServerId, 5);
  assert.equal(singleLineRecentEvents[0]?.source, "kill");
  assert.equal(singleLineRecentEvents[0]?.victim_name, "Demonchaser69420");
  assert.equal(singleLineRecentEvents[0]?.killer_name, "xAKA-MINI_KickAs");
  assert.equal(singleLineRecentEvents[0]?.weapon, "M4-A1");
  assert.equal(singleLineRecentEvents[0]?.distance, 24.38);

  const duplicateSingleLineResult = await importAdmTextForServer(makeEnv(singleLineDb), {
    linkedServerId,
    filename: demonchaserFixtureName,
    admText: demonchaserKillLine,
    source: "manual_paste",
  });
  assert.equal(singleLineDb.killEvents.length, 1);
  assert.equal(duplicateSingleLineResult.parsed_kills, 1);
  assert.equal(duplicateSingleLineResult.written_kills, 0);
  assert.equal(duplicateSingleLineResult.duplicate_skips >= 1, true);

  const bulkPreview = await importAdmFilesForServer(makeEnv(new MemoryD1()), {
    linkedServerId,
    files: bulkFixtureFiles,
    source: "manual_file_upload",
    previewOnly: true,
  });
  assert.equal(bulkPreview.mode, "preview");
  assert.equal(bulkPreview.files_uploaded, 3);
  assert.equal(bulkPreview.parsed_kills, 55);
  assert.equal(bulkPreview.joins, 83);
  assert.equal(bulkPreview.disconnects, 8);
  assert.equal(bulkPreview.playerlist_snapshots, 15);
  assert.deepEqual(bulkPreview.files.map((file) => file.filename), [...bulkFixtureNames]);

  const bulkDb = new MemoryD1();
  const bulkResult = await importAdmFilesForServer(makeEnv(bulkDb), {
    linkedServerId,
    files: [...bulkFixtureFiles].reverse(),
    source: "manual_file_upload",
  });
  assert.equal(bulkResult.mode, "import");
  assert.equal(bulkResult.files_uploaded, 3);
  assert.equal(bulkResult.files_imported, 3);
  assert.equal(bulkResult.failed_files, 0);
  assert.equal(bulkResult.parsed_kills, 55);
  assert.equal(bulkResult.written_kills, 55);
  assert.equal(bulkResult.joins, 83);
  assert.equal(bulkResult.disconnects, 8);
  assert.equal(bulkResult.playerlist_snapshots, 15);
  assert.equal(bulkResult.public_cache_updated, true);
  assert.equal(bulkResult.discord_jobs_queued > 0, true);
  assert.deepEqual(bulkResult.files.map((file) => file.filename), [...bulkFixtureNames]);
  assert.equal(bulkDb.killEvents.length, 55);
  assert.equal(bulkDb.serverStats.get(linkedServerId)?.total_kills, 55);
  assert.equal(bulkDb.serverStats.get(linkedServerId)?.total_joins, 83);
  assert.equal(bulkDb.serverStats.get(linkedServerId)?.total_disconnects, 8);
  assert.equal(bulkDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(bulkDb.automationJobs.length > 0, true);
  const bulkRecentEvents = await getRecentAdmSyncEvents(makeEnv(bulkDb), "fixture-user", linkedServerId, 25);
  assert.equal(bulkRecentEvents.length > 0, true);
  assert.equal(bulkRecentEvents.some((event) => event.source === "kill"), true);
  const bulkTopKillers = countBy(bulkDb.killEvents, "killer_name");
  assert.equal(Number(bulkTopKillers["xAKA-MINI_KickAs"] ?? 0) > 0, true);

  const duplicateBulkResult = await importAdmFilesForServer(makeEnv(bulkDb), {
    linkedServerId,
    files: bulkFixtureFiles,
    source: "manual_file_upload",
  });
  assert.equal(duplicateBulkResult.parsed_kills, 55);
  assert.equal(duplicateBulkResult.written_kills, 0);
  assert.equal(duplicateBulkResult.duplicate_kills_skipped >= 55, true);
  assert.equal(bulkDb.killEvents.length, 55);
  assert.equal(bulkDb.serverStats.get(linkedServerId)?.total_kills, 55);

  const sequentialDb = new MemoryD1();
  const sequentialResults = [];
  for (const file of [...bulkFixtureFiles].reverse()) {
    sequentialResults.push(await importAdmFilesForServer(makeEnv(sequentialDb), {
      linkedServerId,
      files: [file],
      source: "manual_file_upload",
    }));
  }
  const sequentialWrittenKills = sequentialResults.reduce((total, result) => total + result.written_kills, 0);
  const sequentialParsedKills = sequentialResults.reduce((total, result) => total + result.parsed_kills, 0);
  assert.equal(sequentialResults.every((result) => result.files_uploaded === 1), true);
  assert.equal(sequentialParsedKills, 55);
  assert.equal(sequentialWrittenKills, 55);
  assert.equal(sequentialDb.killEvents.length, 55);
  assert.equal(sequentialDb.serverStats.get(linkedServerId)?.total_kills, 55);
  assert.equal(sequentialDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(sequentialDb.automationJobs.length > 0, true);
  const sequentialRecentEvents = await getRecentAdmSyncEvents(makeEnv(sequentialDb), "fixture-user", linkedServerId, 25);
  assert.equal(sequentialRecentEvents.some((event) => event.source === "kill"), true);

  const partialRetryDb = new MemoryD1();
  const alreadyImported = await importAdmFilesForServer(makeEnv(partialRetryDb), {
    linkedServerId,
    files: [bulkFixtureFiles[0]],
    source: "manual_file_upload",
  });
  const duplicateFirstSequential = await importAdmFilesForServer(makeEnv(partialRetryDb), {
    linkedServerId,
    files: [bulkFixtureFiles[0]],
    source: "manual_file_upload",
  });
  const secondSequential = await importAdmFilesForServer(makeEnv(partialRetryDb), {
    linkedServerId,
    files: [bulkFixtureFiles[1]],
    source: "manual_file_upload",
  });
  const thirdSequential = await importAdmFilesForServer(makeEnv(partialRetryDb), {
    linkedServerId,
    files: [bulkFixtureFiles[2]],
    source: "manual_file_upload",
  });
  assert.equal(alreadyImported.written_kills, 5);
  assert.equal(duplicateFirstSequential.written_kills, 0);
  assert.equal(duplicateFirstSequential.duplicate_kills_skipped >= 5, true);
  assert.equal(secondSequential.written_kills, 21);
  assert.equal(thirdSequential.written_kills, 29);
  assert.equal(partialRetryDb.killEvents.length, 55);

  const discordQueueFailureDb = new MemoryD1({ failAutomationJobInsert: true });
  const discordQueueFailureResult = await importAdmFilesForServer(makeEnv(discordQueueFailureDb), {
    linkedServerId,
    files: [bulkFixtureFiles[0]],
    source: "manual_file_upload",
  });
  assert.equal(discordQueueFailureResult.failed_files, 0);
  assert.equal(discordQueueFailureResult.written_kills, 5);
  assert.equal(discordQueueFailureResult.discord_jobs_queued, 0);
  assert.equal(discordQueueFailureResult.warnings.some((warning) => warning.includes("Discord auto-post queueing failed")), true);

  const chunkedDb = new MemoryD1();
  const chunkedResults = [];
  for (const file of bulkFixtureFiles) {
    const progress = await importChunkedAdmText(makeEnv(chunkedDb), linkedServerId, file.filename, file.admText, { chunkSize: 10 });
    assert.equal(progress.file_result?.status, "imported");
    assert.equal(progress.total_chunks > 1, true);
    chunkedResults.push(progress.file_result);
  }
  assert.equal(chunkedResults.reduce((total, file) => total + Number(file?.parsed_kills ?? 0), 0), 55);
  assert.equal(chunkedResults.reduce((total, file) => total + Number(file?.written_kills ?? 0), 0), 55);
  assert.equal(chunkedResults.reduce((total, file) => total + Number(file?.joins ?? 0), 0), 83);
  assert.equal(chunkedResults.reduce((total, file) => total + Number(file?.disconnects ?? 0), 0), 8);
  assert.equal(chunkedResults.reduce((total, file) => total + Number(file?.playerlist_snapshots ?? 0), 0), 15);
  assert.equal(chunkedDb.killEvents.length, 55);
  assert.equal(chunkedDb.serverStats.get(linkedServerId)?.total_kills, 55);
  assert.equal(chunkedDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(chunkedDb.automationJobs.length > 0, true);
  assert.equal(chunkedDb.playerEvents.filter((event) => String(event.event_type).startsWith("player_hit")).length, 0);

  const largePreview = previewManualAdmText({
    filename: largeFixtureName,
    admText: largeFixtureText,
  });
  assert.equal(largeFixtureLines.length, 3385);
  assert.equal(largePreview.raw_lines, 3385);
  assert.equal(largePreview.raw_kill_lines_found, 216);
  assert.equal(largePreview.parsed_kills, 216);
  assert.equal(largePreview.joins, 378);
  assert.equal(largePreview.disconnects, 15);
  assert.equal(largePreview.playerlist_snapshots, 10);

  const largeBrowserDb = new MemoryD1();
  const largeBrowserImport = await importChunkedAdmText(makeEnv(largeBrowserDb), linkedServerId, largeFixtureName, largeFixtureText, { chunkSize: 10 });
  assert.equal(largeBrowserImport.status, "completed");
  assert.equal(largeBrowserImport.total_chunks, Math.ceil(3385 / 10));
  assert.equal(largeBrowserImport.file_result?.parsed_kills, 216);
  assert.equal(largeBrowserImport.file_result?.written_kills, 216);
  assert.equal(largeBrowserImport.file_result?.joins, 378);
  assert.equal(largeBrowserImport.file_result?.disconnects, 15);
  assert.equal(largeBrowserImport.file_result?.playerlist_snapshots, 10);
  assert.equal(largeBrowserDb.killEvents.length, 216);
  assert.equal(largeBrowserDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);

  const activeBrowserJobDb = new MemoryD1();
  let activeBrowserProgress = await startAdmImportLineJobForServer(makeEnv(activeBrowserJobDb), {
    linkedServerId,
    filename: largeFixtureName,
    totalLines: largeFixtureLines.length,
    totalChunks: Math.ceil(largeFixtureLines.length / 10),
    source: "manual_file_upload",
    chunkSize: 10,
  });
  const activeBrowserChunks = chunkAdmLines(largeFixtureLines, 10);
  for (let index = 0; index < 21; index += 1) {
    const chunk = activeBrowserChunks[index];
    activeBrowserProgress = await processAdmImportJobLineChunk(makeEnv(activeBrowserJobDb), {
      linkedServerId,
      jobId: activeBrowserProgress.job_id,
      filename: largeFixtureName,
      chunkIndex: index,
      startLine: chunk.startLine,
      lines: chunk.lines,
      previousLines: largeFixtureLines.slice(Math.max(0, chunk.startLine - 5), chunk.startLine),
    });
  }
  assert.equal(activeBrowserProgress.status, "queued");
  assert.equal(activeBrowserProgress.chunks_processed, 21);
  assert.equal(activeBrowserProgress.current_line, 210);
  assert.equal(activeBrowserProgress.total_chunks, 339);
  const simulatedProductionActiveJob = activeBrowserJobDb.admImportJobs.get(activeBrowserProgress.job_id);
  if (simulatedProductionActiveJob) {
    simulatedProductionActiveJob.parsed_kills = 19;
    simulatedProductionActiveJob.written_kills = 6;
  }
  const activeById = await getAdmImportJobProgressForServer(makeEnv(activeBrowserJobDb), {
    linkedServerId,
    jobId: activeBrowserProgress.job_id,
  });
  assert.equal(activeById?.job_id, activeBrowserProgress.job_id);
  assert.equal(activeById?.chunks_processed, 21);
  assert.equal(activeById?.parsed_kills, 19);
  assert.equal(activeById?.written_kills, 6);
  const activeByFilename = await getLatestAdmImportJobProgressForFilename(makeEnv(activeBrowserJobDb), {
    linkedServerId,
    filename: largeFixtureName,
  });
  assert.equal(activeByFilename?.job_id, activeBrowserProgress.job_id);
  const reattachedStart = await startAdmImportLineJobForServer(makeEnv(activeBrowserJobDb), {
    linkedServerId,
    filename: largeFixtureName,
    totalLines: largeFixtureLines.length,
    totalChunks: Math.ceil(largeFixtureLines.length / 10),
    source: "manual_file_upload",
    chunkSize: 10,
  });
  assert.equal(reattachedStart.job_id, activeBrowserProgress.job_id);
  assert.equal(reattachedStart.chunks_processed, 21);

  const alreadyProcessedChunk = activeBrowserChunks[20];
  const idempotentProgress = await processAdmImportJobLineChunk(makeEnv(activeBrowserJobDb), {
    linkedServerId,
    jobId: activeBrowserProgress.job_id,
    filename: largeFixtureName,
    chunkIndex: 20,
    startLine: alreadyProcessedChunk.startLine,
    lines: alreadyProcessedChunk.lines,
    previousLines: largeFixtureLines.slice(Math.max(0, alreadyProcessedChunk.startLine - 5), alreadyProcessedChunk.startLine),
  });
  assert.equal(idempotentProgress.already_processed, true);
  assert.equal(idempotentProgress.chunks_processed, 21);

  const fromChunk58Db = new MemoryD1();
  let fromChunk58Progress = await startAdmImportLineJobForServer(makeEnv(fromChunk58Db), {
    linkedServerId,
    filename: largeFixtureName,
    totalLines: largeFixtureLines.length,
    totalChunks: Math.ceil(largeFixtureLines.length / 10),
    source: "manual_file_upload",
    chunkSize: 10,
  });
  for (let index = 0; index < 58; index += 1) {
    const chunk = activeBrowserChunks[index];
    fromChunk58Progress = await processAdmImportJobLineChunk(makeEnv(fromChunk58Db), {
      linkedServerId,
      jobId: fromChunk58Progress.job_id,
      filename: largeFixtureName,
      chunkIndex: index,
      startLine: chunk.startLine,
      lines: chunk.lines,
      previousLines: largeFixtureLines.slice(Math.max(0, chunk.startLine - 5), chunk.startLine),
    });
  }
  assert.equal(fromChunk58Progress.chunks_processed, 58);
  assert.equal(fromChunk58Progress.status, "queued");
  for (let index = 58; index < activeBrowserChunks.length; index += 1) {
    const chunk = activeBrowserChunks[index];
    fromChunk58Progress = await processAdmImportJobLineChunk(makeEnv(fromChunk58Db), {
      linkedServerId,
      jobId: fromChunk58Progress.job_id,
      filename: largeFixtureName,
      chunkIndex: index,
      startLine: chunk.startLine,
      lines: chunk.lines,
      previousLines: largeFixtureLines.slice(Math.max(0, chunk.startLine - 5), chunk.startLine),
    });
  }
  assert.equal(fromChunk58Progress.status, "completed");
  assert.equal(fromChunk58Progress.file_result?.parsed_kills, 216);
  assert.equal(fromChunk58Progress.file_result?.written_kills, 216);
  assert.equal(fromChunk58Progress.file_result?.joins, 378);
  assert.equal(fromChunk58Progress.file_result?.disconnects, 15);
  assert.equal(fromChunk58Progress.file_result?.playerlist_snapshots, 10);

  const badChunkCountDb = new MemoryD1();
  const badChunkCountJob = await startAdmImportLineJobForServer(makeEnv(badChunkCountDb), {
    linkedServerId,
    filename: "DayZServer_PS4_x64_2026-05-20_10-02-17.ADM",
    totalLines: 270,
    totalChunks: 21,
    source: "manual_file_upload",
    chunkSize: 10,
  });
  const badChunkCountRow = badChunkCountDb.admImportJobs.get(badChunkCountJob.job_id);
  if (badChunkCountRow) {
    badChunkCountRow.current_line = 270;
    badChunkCountRow.chunks_processed = 27;
    badChunkCountRow.total_chunks = 21;
  }
  const correctedChunkCount = await getAdmImportJobProgressForServer(makeEnv(badChunkCountDb), {
    linkedServerId,
    jobId: badChunkCountJob.job_id,
  });
  assert.equal(correctedChunkCount?.total_chunks, 27);
  assert.equal(correctedChunkCount?.chunks_processed, 27);
  assert.equal(correctedChunkCount?.display_current_chunk, 27);
  assert.equal(correctedChunkCount?.chunk_count_mismatch, true);

  const finalChunkAutoFinishDb = new MemoryD1();
  let finalChunkAutoFinish = await startAdmImportLineJobForServer(makeEnv(finalChunkAutoFinishDb), {
    linkedServerId,
    filename: latestFixtureName,
    totalLines: 1,
    totalChunks: 1,
    source: "manual_file_upload",
    chunkSize: 1,
  });
  finalChunkAutoFinish = await processAdmImportJobLineChunk(makeEnv(finalChunkAutoFinishDb), {
    linkedServerId,
    jobId: finalChunkAutoFinish.job_id,
    filename: latestFixtureName,
    chunkIndex: 0,
    startLine: 0,
    lines: ['12:00:00 | Player "AutoFinish" is connected'],
    previousLines: [],
  });
  assert.equal(finalChunkAutoFinish.status, "completed");
  assert.equal(finalChunkAutoFinish.file_result?.joins, 1);

  const cancelJobDb = new MemoryD1();
  const cancelJob = await createAdmImportJobForServer(makeEnv(cancelJobDb), {
    linkedServerId,
    filename: largeFixtureName,
    admText: largeFixtureText,
    source: "scheduled_nitrado",
    chunkSize: 100,
  });
  const cancelledJob = await cancelAdmImportLineJobForServer(makeEnv(cancelJobDb), {
    linkedServerId,
    jobId: cancelJob.job_id,
  });
  assert.equal(cancelledJob.status, "cancelled");

  const finishWarningDb = new MemoryD1({ failAutomationJobInsert: true });
  const finishWarningImport = await importChunkedAdmText(makeEnv(finishWarningDb), linkedServerId, largeFixtureName, largeFixtureText, { chunkSize: 10 });
  assert.equal(finishWarningImport.status, "completed_with_warnings");
  assert.equal(finishWarningImport.file_result?.status, "completed_with_warnings");
  assert.equal(finishWarningImport.file_result?.parsed_kills, 216);
  assert.equal(finishWarningImport.file_result?.written_kills, 216);
  assert.equal(finishWarningImport.file_result?.joins, 378);
  assert.equal(finishWarningImport.file_result?.disconnects, 15);
  assert.equal(finishWarningImport.file_result?.playerlist_snapshots, 10);
  assert.equal(finishWarningImport.file_result?.discord_jobs_queued, 0);
  assert.equal(finishWarningImport.file_result?.parser_warnings.some((warning) => warning.includes("Discord auto-post queueing failed")), true);
  assert.equal(finishWarningDb.killEvents.length, 216);
  assert.equal(finishWarningDb.serverStats.get(linkedServerId)?.total_kills, 216);

  const scheduledJobDb = new MemoryD1();
  const scheduledJob = await createAdmImportJobForServer(makeEnv(scheduledJobDb), {
    linkedServerId,
    filename: largeFixtureName,
    admText: largeFixtureText,
    source: "scheduled_nitrado",
    chunkSize: 10,
  });
  assert.equal(scheduledJob.source, "scheduled_nitrado");
  assert.equal(scheduledJob.total_lines, 3385);
  assert.equal(scheduledJob.total_chunks, Math.ceil(3385 / 10));
  assert.equal(scheduledJob.import_hit_lines, false);
  const continuedScheduled = await processNextAdmImportJobChunk(makeEnv(scheduledJobDb), {
    linkedServerId,
    jobId: scheduledJob.job_id,
  });
  assert.equal(continuedScheduled.current_line, 10);
  const firstScheduledTick = await processPendingAdmImportJobs(makeEnv(scheduledJobDb), { maxJobs: 1, maxChunksPerJob: 2 });
  assert.equal(firstScheduledTick.processedJobs, 1);
  assert.equal(firstScheduledTick.chunksProcessed, 2);
  assert.equal(firstScheduledTick.completedJobs, 0);
  const firstProgress = firstScheduledTick.results[0];
  assert.equal(firstProgress?.status, "queued");
  assert.equal(firstProgress?.current_line, 30);
  assert.notEqual(firstProgress?.current_line, largeFixtureLines.length);
  assert.notEqual(scheduledJobDb.admSyncState.get(linkedServerId)?.last_processed_file, largeFixtureName);
  assert.equal(scheduledJobDb.admSyncState.get(linkedServerId)?.last_sync_status, "processing_in_chunks");
  let scheduledLoops = 0;
  let scheduledPending = firstScheduledTick;
  while (scheduledPending.completedJobs === 0 && scheduledLoops < 400) {
    scheduledPending = await processPendingAdmImportJobs(makeEnv(scheduledJobDb), { maxJobs: 1, maxChunksPerJob: 5 });
    scheduledLoops += 1;
  }
  const scheduledCompleted = scheduledPending.results.at(-1);
  assert.equal(scheduledCompleted?.status, "completed");
  assert.equal(scheduledCompleted?.file_result?.parsed_kills, 216);
  assert.equal(scheduledCompleted?.file_result?.written_kills, 216);
  assert.equal(scheduledCompleted?.file_result?.joins, 378);
  assert.equal(scheduledCompleted?.file_result?.disconnects, 15);
  assert.equal(scheduledCompleted?.file_result?.playerlist_snapshots, 10);
  assert.equal(scheduledCompleted?.file_result?.hit_lines, 0);
  assert.equal(scheduledJobDb.killEvents.length, 216);
  assert.equal(scheduledJobDb.serverStats.get(linkedServerId)?.total_kills, 216);
  assert.equal(scheduledJobDb.serverPublicCache.get(guildId)?.last_adm_update_at !== null, true);
  assert.equal(scheduledJobDb.automationJobs.length > 0, true);
  assert.equal(scheduledJobDb.admSyncState.get(linkedServerId)?.last_processed_file, largeFixtureName);
  assert.equal(scheduledJobDb.admSyncState.get(linkedServerId)?.cursor_recovery_reason, "scheduled_chunked_import");
  assert.equal(JSON.parse(String(scheduledJobDb.syncRuns.at(-1)?.message ?? "{}")).type, "scheduled_adm_import");

  const buildFixtureName = "DayZServer_PS4_x64_2026-05-31_20-01-53.ADM";
  const buildFixtureLines = [
    "AdminLog started on 2026-05-31 at 20:01:53",
    '20:02:00 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) placed Fence Kit<FenceKit>',
    '20:02:01 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) placed Watchtower Kit<WatchtowerKit>',
    '20:02:02 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) placed Wooden Crate<WoodenCrate>',
    '20:02:03 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) placed Construction Light<Spotlight>',
    '20:02:04 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) placed Tripwire<TripwireTrap>',
    '20:02:05 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>)Built base on Fence with Pickaxe',
    '20:02:06 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>)Built wall_gate on Gate with Pliers',
    '20:02:07 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>)Built level_3_wall_3_metal_down on Watchtower with Hammer',
    '20:02:08 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>)Dismantled Upper Wooden Wall from Watchtower with Hatchet',
    '20:02:09 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) folded Fence',
    '20:02:10 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) has raised Flag_SSahrani on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
    '20:02:11 | Player "kurux2pa" (id=BUILD_ID pos=<8250.8, 7003.2, 353.2>) has lowered Flag_NSahrani on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
  ];
  const buildFixtureEvents = parseAdmLines(buildFixtureLines, { admDate: "2026-05-31" }).map((event) => classifyParsedBuildEvent(event)).filter(Boolean);
  assert.equal(buildFixtureEvents.length, 12);
  assert.equal(buildFixtureEvents.filter((event) => event?.eventType === "built").length, 3);
  assert.equal(buildFixtureEvents.filter((event) => event?.eventType === "placed").length, 5);
  assert.equal(buildFixtureEvents.some((event) => event?.eventType === "folded"), true);
  assert.equal(buildFixtureEvents.some((event) => event?.eventType === "flag_raised"), true);
  assert.equal(buildFixtureEvents.some((event) => event?.eventType === "flag_lowered"), true);
  const buildScheduledDb = new MemoryD1();
  await createAdmImportJobForServer(makeEnv(buildScheduledDb), {
    linkedServerId,
    filename: buildFixtureName,
    admText: buildFixtureLines.join("\n"),
    source: "scheduled_nitrado",
    chunkSize: 4,
  });
  let buildScheduledPending = await processPendingAdmImportJobs(makeEnv(buildScheduledDb), { maxJobs: 1, maxChunksPerJob: 1 });
  let buildScheduledLoops = 0;
  while (buildScheduledPending.completedJobs === 0 && buildScheduledLoops < 20) {
    buildScheduledPending = await processPendingAdmImportJobs(makeEnv(buildScheduledDb), { maxJobs: 1, maxChunksPerJob: 1 });
    buildScheduledLoops += 1;
  }
  assert.equal(buildScheduledPending.completedJobs, 1);
  assert.equal(buildScheduledDb.buildEvents.length, 12);
  assert.deepEqual(countBy(buildScheduledDb.buildEvents, "event_type"), {
    placed: 5,
    built: 3,
    dismantled: 1,
    folded: 1,
    flag_raised: 1,
    flag_lowered: 1,
  });
  await rebuildServerBuildStats(makeEnv(buildScheduledDb), linkedServerId);
  assert.equal(buildScheduledDb.serverBuildStats.has(linkedServerId), true);
  await importReadableAdmLinesIntoDatabase(makeEnv(buildScheduledDb), {
    context: { ...context, admFileName: buildFixtureName, syncRunId: "build-fixture-duplicate" },
    lines: buildFixtureLines,
    guildId,
    planKey: "partner",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(buildScheduledDb.buildEvents.length, 12);
  await importReadableAdmLinesIntoDatabase(makeEnv(buildScheduledDb), {
    context: { ...context, admFileName: "DayZServer_PS4_x64_2026-05-31_21-02-27.ADM", syncRunId: "build-fixture-no-build" },
    lines: [
      "AdminLog started on 2026-05-31 at 21:02:27",
      '21:02:30 | Player "NoBuild" (id=NO_BUILD_ID pos=<1, 2, 3>) is connected',
    ],
    guildId,
    planKey: "partner",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(buildScheduledDb.buildEvents.length, 12);
  await rebuildServerBuildStats(makeEnv(buildScheduledDb), linkedServerId);
  assert.equal(buildScheduledDb.serverBuildStats.has(linkedServerId), true);

  const buildReparseDb = new MemoryD1();
  const reparseFileName = "DayZServer_PS4_x64_2026-05-31_22-01-00.ADM";
  const reparseLines = [
    "AdminLog started on 2026-05-31 at 22:01:00",
    '22:02:00 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Red>',
    '22:02:01 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Blue>',
    '22:02:02 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) placed Barrel<Barrel_Yellow>',
    '22:02:03 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) placed Sea Chest<SeaChest>',
    '22:02:04 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) placed Wooden Crate<WoodenCrate>',
    '22:02:05 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>)Built wall_platform on Fence with Hatchet',
    '22:02:06 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) Built wall_platform on Fence with Hatchet',
    '22:02:07 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) has raised Flag_Zagorky on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
    '22:02:08 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) has lowered Flag_Zagorky on TerritoryFlag at <8250.864258, 353.267975, 7003.206543>',
    '22:02:09 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>) performed EmoteSitA',
    '22:02:10 | Player "Builder" (id=BUILD_ID pos=<22.4, 7891.5, 303.1>)[HP: 97.5775] hit by Infected into Torso(1) for 2.4225 damage (MeleeInfectedLong)',
    "22:02:11 | ##### PlayerList log: 1 players",
  ];
  const reparseCreatedAt = new Date().toISOString();
  for (const [index, rawLine] of reparseLines.entries()) {
    buildReparseDb.admRawEvents.push({
      id: `raw-reparse-${index + 1}`,
      linked_server_id: linkedServerId,
      source_service_id: nitradoServiceId,
      adm_file: reparseFileName,
      source_adm_file: reparseFileName,
      line_number: index + 1,
      source_line_number: index + 1,
      raw_line: rawLine,
      event_type: "unknown",
      created_at: reparseCreatedAt,
    });
  }
  const reparseResult = await processRecentAdmBuildReparse(makeEnv(buildReparseDb), { maxFiles: 1, maxRawLines: 50 });
  assert.equal(reparseResult.ok, true);
  assert.equal(reparseResult.rawLinesScanned, reparseLines.length);
  assert.equal(reparseResult.buildEventsFound, 9);
  assert.equal(reparseResult.buildEventsAdded, 9);
  assert.deepEqual(countBy(buildReparseDb.buildEvents, "event_type"), {
    placed: 5,
    built: 2,
    flag_raised: 1,
    flag_lowered: 1,
  });
  assert.deepEqual(buildReparseDb.buildEvents.filter((event) => event.event_type === "placed").map((event) => event.placed_class), [
    "barrel_red",
    "barrel_blue",
    "barrel_yellow",
    "seachest",
    "woodencrate",
  ]);
  assert.equal(buildReparseDb.buildEvents.filter((event) => event.build_part === "wall_platform").length, 2);
  assert.equal(buildReparseDb.killEvents.length, 0);
  assert.equal(buildReparseDb.playerEvents.length, 0);
  assert.equal(buildReparseDb.serverBuildStats.get(linkedServerId)?.structures_built, 2);
  assert.equal(buildReparseDb.serverBuildStats.get(linkedServerId)?.storage_items_placed, 5);
  assert.equal(buildReparseDb.serverBuildStats.get(linkedServerId)?.build_score, 35);
  assert.equal(buildReparseDb.serverPublicCache.has(guildId), true);
  const duplicateReparse = await processRecentAdmBuildReparse(makeEnv(buildReparseDb), { maxFiles: 1, maxRawLines: 50 });
  assert.equal(duplicateReparse.buildEventsAdded, 0);
  assert.equal(buildReparseDb.buildEvents.length, 9);

  assert.equal(isAdmFileNewerThan("DayZServer_PS4_x64_2026-05-20_13-02-00.ADM", largeFixtureName), true);
  assert.equal(isAdmFileNewerThan(largeFixtureName, largeFixtureName), false);
  assert.equal(isAdmFileNewerThan("DayZServer_PS4_x64_2026-05-19_16-01-55.ADM", largeFixtureName), false);

  const scheduledCreateDb = new MemoryD1();
  const scheduledCreate = await createScheduledAdmImportJobForServer(
    { ...makeEnv(scheduledCreateDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  assert.equal(scheduledCreate.status, "adm_import_job_queued");
  assert.equal(scheduledCreate.job?.source, "scheduled_nitrado");
  assert.equal(scheduledCreate.job?.current_line, 0);
  assert.equal(scheduledCreate.job?.chunks_processed, 0);
  assert.equal(scheduledCreateDb.admImportJobs.size, 1);
  assert.equal(String([...scheduledCreateDb.admImportJobs.values()][0]?.adm_text ?? "").includes("AdminLog started"), true);
  const repeatedScheduledCreate = await createScheduledAdmImportJobForServer(
    { ...makeEnv(scheduledCreateDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  assert.equal(repeatedScheduledCreate.duplicateExistingJob, true);
  assert.equal(repeatedScheduledCreate.job?.current_line, 0);
  assert.equal(repeatedScheduledCreate.job?.chunks_processed, 0);

  const scheduledTailDb = new MemoryD1();
  const scheduledTailFirst = await createScheduledAdmImportJobForServer(
    { ...makeEnv(scheduledTailDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  const scheduledTailRow = scheduledTailDb.admImportJobs.get(String(scheduledTailFirst.job?.job_id));
  assert.ok(scheduledTailRow);
  const scheduledTailLines = String(scheduledTailRow.adm_text ?? "").split(/\r?\n/).filter(Boolean);
  scheduledTailRow.status = "completed";
  scheduledTailRow.current_line = 2;
  scheduledTailRow.total_lines = 2;
  scheduledTailRow.chunk_size = 2;
  scheduledTailRow.total_chunks = 1;
  scheduledTailRow.chunks_processed = 1;
  scheduledTailRow.adm_text = scheduledTailLines.slice(0, 2).join("\n");
  scheduledTailRow.completed_at = "2026-05-20T12:00:00.000Z";
  const scheduledTailGrowth = await createScheduledAdmImportJobForServer(
    { ...makeEnv(scheduledTailDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  assert.equal(scheduledTailGrowth.status, "adm_import_job_queued");
  assert.equal(scheduledTailGrowth.duplicateExistingJob, true);
  assert.equal(scheduledTailGrowth.job?.job_id, scheduledTailFirst.job?.job_id);
  assert.equal(scheduledTailGrowth.job?.current_line, 2);
  assert.equal(scheduledTailGrowth.job?.total_lines, scheduledTailLines.length);
  assert.equal(scheduledTailDb.admImportJobs.size, 1);

  const scheduledDuplicateDb = new MemoryD1();
  const mockAdmName = "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM";
  scheduledDuplicateDb.admSyncState.set(linkedServerId, {
    linked_server_id: linkedServerId,
    latest_adm_file: mockAdmName,
    latest_adm_path: mockAdmName,
    last_processed_file: mockAdmName,
    last_processed_line: 15,
    last_processed_offset: 15,
    last_sync_status: "completed",
    last_sync_message: "Manual import completed.",
    last_sync_at: "2026-05-20T12:00:00.000Z",
  });
  const scheduledDuplicate = await createScheduledAdmImportJobForServer(
    { ...makeEnv(scheduledDuplicateDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  assert.equal(scheduledDuplicate.status, "caught_up_waiting_for_growth");
  assert.equal(scheduledDuplicate.job, null);
  assert.equal(scheduledDuplicateDb.admImportJobs.size, 0);

  const manualCompletedDedupeDb = new MemoryD1();
  const manualMockImport = await importAdmTextForServer(makeEnv(manualCompletedDedupeDb), {
    linkedServerId,
    filename: mockAdmName,
    admText: [
      "AdminLog started on 2026-05-14 at 13:45:00",
      '13:45:05 | Player "MockSurvivor" is connected',
      '13:47:22 | Player "MockSurvivor" has been disconnected',
    ].join("\n"),
    source: "manual_file_upload",
  });
  assert.equal(manualMockImport.ok, true);
  assert.equal(manualCompletedDedupeDb.admSyncState.get(linkedServerId)?.last_processed_file, mockAdmName);
  const manualCompletedScheduledDuplicate = await createScheduledAdmImportJobForServer(
    { ...makeEnv(manualCompletedDedupeDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  assert.equal(manualCompletedScheduledDuplicate.status, "adm_import_job_queued");
  assert.equal(manualCompletedScheduledDuplicate.job?.source, "scheduled_nitrado");
  assert.equal(manualCompletedScheduledDuplicate.job?.current_line, 3);
  assert.equal(manualCompletedDedupeDb.admImportJobs.size, 1);

  const newerAfterCompletedDb = new MemoryD1();
  newerAfterCompletedDb.admSyncState.set(linkedServerId, {
    linked_server_id: linkedServerId,
    latest_adm_file: "DAYZSERVER_PS4_X64_2026-05-13_11-29-09.ADM",
    latest_adm_path: "DAYZSERVER_PS4_X64_2026-05-13_11-29-09.ADM",
    last_processed_file: "DAYZSERVER_PS4_X64_2026-05-13_11-29-09.ADM",
    last_processed_line: 14,
    last_processed_offset: 14,
    last_sync_status: "completed",
    last_sync_message: "Earlier ADM import completed.",
    last_sync_at: "2026-05-20T12:00:00.000Z",
  });
  const newerAfterCompleted = await createScheduledAdmImportJobForServer(
    { ...makeEnv(newerAfterCompletedDb), MOCK_NITRADO: "true" },
    "fixture-user",
    linkedServerId,
    { processImmediately: false },
  );
  assert.equal(newerAfterCompleted.status, "adm_import_job_queued");
  assert.equal(newerAfterCompleted.job?.filename, mockAdmName);
  assert.equal(newerAfterCompletedDb.admImportJobs.size, 1);

  const staleScheduledDb = new MemoryD1();
  const staleScheduledJob = await createAdmImportJobForServer(makeEnv(staleScheduledDb), {
    linkedServerId,
    filename: largeFixtureName,
    admText: largeFixtureText,
    source: "scheduled_nitrado",
    chunkSize: 10,
  });
  const staleRow = staleScheduledDb.admImportJobs.get(staleScheduledJob.job_id);
  if (staleRow) {
    staleRow.status = "writing";
    staleRow.updated_at = "2026-05-20T10:00:00.000Z";
  }
  const recoveredStaleScheduled = await processPendingAdmImportJobs(makeEnv(staleScheduledDb), { maxJobs: 1, maxChunksPerJob: 1 });
  assert.equal(recoveredStaleScheduled.processedJobs, 1);
  assert.equal(recoveredStaleScheduled.chunksProcessed, 1);
  const recoveredStaleRow = staleScheduledDb.admImportJobs.get(staleScheduledJob.job_id);
  assert.equal(Number(recoveredStaleRow?.chunk_size ?? 0) <= 50, true);
  assert.equal(recoveredStaleRow?.current_line, recoveredStaleRow?.chunk_size);

  const duplicateLargeManual = await importChunkedAdmText(makeEnv(scheduledJobDb), linkedServerId, largeFixtureName, largeFixtureText, { chunkSize: 10 });
  assert.equal(duplicateLargeManual.file_result?.parsed_kills, 216);
  assert.equal(duplicateLargeManual.file_result?.written_kills, 0);
  assert.equal(duplicateLargeManual.file_result?.status, "completed_duplicate_only");
  assert.equal(Number(duplicateLargeManual.file_result?.duplicate_skips ?? 0) >= 216, true);
  assert.equal(scheduledJobDb.killEvents.length, 216);

  const duplicateChunkedResults = [];
  for (const file of bulkFixtureFiles) {
    const progress = await importChunkedAdmText(makeEnv(chunkedDb), linkedServerId, file.filename, file.admText, { chunkSize: 10 });
    duplicateChunkedResults.push(progress.file_result);
  }
  assert.equal(duplicateChunkedResults.reduce((total, file) => total + Number(file?.written_kills ?? 0), 0), 0);
  assert.equal(duplicateChunkedResults.reduce((total, file) => total + Number(file?.duplicate_skips ?? 0), 0) >= 55, true);
  assert.equal(duplicateChunkedResults.every((file) => file?.ok === true && (file?.status === "imported" || file?.status === "duplicate_only" || file?.status === "completed_duplicate_only")), true);
  assert.equal(chunkedDb.killEvents.length, 55);

  const chunkRetryDb = new MemoryD1({ failKillInsertAfter: 0 });
  const retryLines = latestFixtureLines;
  let retryProgress = await startAdmImportLineJobForServer(makeEnv(chunkRetryDb), {
    linkedServerId,
    filename: latestFixtureName,
    totalLines: retryLines.length,
    totalChunks: Math.ceil(retryLines.length / 25),
    source: "manual_file_upload",
    chunkSize: 25,
  });
  await assert.rejects(
    () => processAdmImportJobLineChunk(makeEnv(chunkRetryDb), {
      linkedServerId,
      jobId: retryProgress.job_id,
      filename: latestFixtureName,
      chunkIndex: 0,
      startLine: 0,
      lines: retryLines.slice(0, 25),
      previousLines: [],
    }),
    /simulated kill_events write failure/,
  );
  assert.equal(chunkRetryDb.admImportJobs.get(retryProgress.job_id)?.current_line, 0);
  chunkRetryDb.failKillInsertAfter = null;
  for (const [index, chunk] of chunkAdmLines(retryLines, 25).entries()) {
    retryProgress = await processAdmImportJobLineChunk(makeEnv(chunkRetryDb), {
      linkedServerId,
      jobId: retryProgress.job_id,
      filename: latestFixtureName,
      chunkIndex: index,
      startLine: chunk.startLine,
      lines: chunk.lines,
      previousLines: retryLines.slice(Math.max(0, chunk.startLine - 5), chunk.startLine),
    });
  }
  retryProgress = await finishAdmImportLineJobForServer(makeEnv(chunkRetryDb), { linkedServerId, jobId: retryProgress.job_id });
  assert.equal(retryProgress.file_result?.parsed_kills, 5);
  assert.equal(retryProgress.file_result?.written_kills, 5);
  assert.equal(chunkRetryDb.killEvents.length, 5);

  const badSingleLineDb = new MemoryD1({ failKillInsertAfter: 0 });
  let badSingleLineProgress = await startAdmImportLineJobForServer(makeEnv(badSingleLineDb), {
    linkedServerId,
    filename: demonchaserFixtureName,
    totalLines: 1,
    totalChunks: 1,
    source: "manual_file_upload",
    chunkSize: 1,
  });
  badSingleLineProgress = await processAdmImportJobLineChunk(makeEnv(badSingleLineDb), {
    linkedServerId,
    jobId: badSingleLineProgress.job_id,
    filename: demonchaserFixtureName,
    chunkIndex: 0,
    startLine: 0,
    lines: [demonchaserKillLine],
    previousLines: [],
  });
  assert.equal(badSingleLineProgress.current_line, 1);
  assert.equal(badSingleLineProgress.warnings.some((warning) => warning.includes("skipped line 1")), true);
  badSingleLineDb.failKillInsertAfter = null;
  badSingleLineProgress = await finishAdmImportLineJobForServer(makeEnv(badSingleLineDb), { linkedServerId, jobId: badSingleLineProgress.job_id });
  assert.equal(badSingleLineProgress.status, "completed_with_warnings");
  assert.equal(badSingleLineProgress.file_result?.status, "completed_with_warnings");
  assert.equal(badSingleLineProgress.file_result?.failed_writes, 1);
  assert.equal(badSingleLineDb.killEvents.length, 0);

  const clusteredMustardKills = successDb.killEvents.filter((event) =>
    event.killer_name === "mustard_coffer74" &&
    event.victim_name === "Uractuallybadzzz" &&
    event.weapon === "M4-A1"
  );
  assert.equal(clusteredMustardKills.length, 5);
  assert.deepEqual(clusteredMustardKills.map((event) => event.occurred_at), [
    "2026-05-19T16:07:39.000Z",
    "2026-05-19T16:08:39.000Z",
    "2026-05-19T16:09:25.000Z",
    "2026-05-19T16:10:33.000Z",
    "2026-05-19T16:13:04.000Z",
  ]);

  const retryResult = await importReadableAdmLinesIntoDatabase(makeEnv(successDb), {
    context: { ...context, syncRunId: "fixture-sync-run-retry" },
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(retryResult.status, "completed");
  assert.equal(successDb.killEvents.length, 10);
  assert.equal(retryResult.report.parsedPvpKills, 0);
  assert.equal(retryResult.report.cursorBefore, 25);
  assert.equal(retryResult.report.cursorAfter, 25);
  assert.equal(retryResult.report.cursorValidationStatus, "valid");
  assert.equal(retryResult.report.cursorHashMatched, true);

  const appendedKillLine = `16:40:00 | Player "lateVictim" (DEAD) (id=LATE_V pos=<0, 0, 0>) killed by Player "lateKiller" (id=LATE_K pos=<1, 1, 1>) with M4-A1 from 15.5 meters`;
  const appendedLines = [...fixtureLines, appendedKillLine];
  const resumeDb = new MemoryD1();
  await importReadableAdmLinesIntoDatabase(makeEnv(resumeDb), {
    context: { ...context, linkedServerId: "resume-server", syncRunId: "resume-initial" },
    lines: fixtureLines,
  });
  const resumeResult = await importReadableAdmLinesIntoDatabase(makeEnv(resumeDb), {
    context: { ...context, linkedServerId: "resume-server", syncRunId: "resume-appended" },
    lines: appendedLines,
  });
  assert.equal(resumeResult.report.cursorValidationStatus, "valid");
  assert.equal(resumeResult.report.cursorBefore, 25);
  assert.equal(resumeResult.report.cursorAfter, 26);
  assert.equal(resumeResult.report.parsedPvpKills, 1);
  assert.equal(resumeDb.killEvents.filter((event) => event.linked_server_id === "resume-server").length, 11);

  const legacyDb = new MemoryD1();
  await importReadableAdmLinesIntoDatabase(makeEnv(legacyDb), {
    context: { ...context, linkedServerId: "legacy-server", syncRunId: "legacy-initial" },
    lines: fixtureLines,
  });
  const legacyState = legacyDb.admSyncState.get("legacy-server");
  if (legacyState) legacyState.last_processed_adm_line_hash = null;
  const legacyResult = await importReadableAdmLinesIntoDatabase(makeEnv(legacyDb), {
    context: { ...context, linkedServerId: "legacy-server", syncRunId: "legacy-appended" },
    lines: appendedLines,
  });
  assert.equal(legacyResult.report.cursorValidationStatus, "legacy_no_hash");
  assert.equal(legacyResult.report.cursorBefore, 25);
  assert.equal(legacyResult.report.cursorAfter, 26);
  assert.match(String(legacyDb.admSyncState.get("legacy-server")?.last_processed_adm_line_hash ?? ""), /^[a-f0-9]{40}$/);

  const mismatchDb = new MemoryD1();
  await importReadableAdmLinesIntoDatabase(makeEnv(mismatchDb), {
    context: { ...context, linkedServerId: "mismatch-server", syncRunId: "mismatch-initial" },
    lines: fixtureLines,
  });
  const mismatchState = mismatchDb.admSyncState.get("mismatch-server");
  if (mismatchState) {
    mismatchState.last_processed_line = 20;
    mismatchState.last_processed_adm_line_hash = "0000000000000000000000000000000000000000";
  }
  const mismatchResult = await importReadableAdmLinesIntoDatabase(makeEnv(mismatchDb), {
    context: { ...context, linkedServerId: "mismatch-server", syncRunId: "mismatch-recovery" },
    lines: fixtureLines,
  });
  assert.equal(mismatchResult.report.cursorValidationStatus, "safe_tail_reprocess");
  assert.equal(mismatchResult.report.cursorRecoveryStrategy, "safe_tail_reprocess");
  assert.equal(mismatchDb.killEvents.filter((event) => event.linked_server_id === "mismatch-server").length, 10);
  assert.equal(mismatchDb.admSyncState.get("mismatch-server")?.last_processed_line, 25);

  const repositionDb = new MemoryD1();
  await importReadableAdmLinesIntoDatabase(makeEnv(repositionDb), {
    context: { ...context, linkedServerId: "reposition-server", syncRunId: "reposition-initial" },
    lines: fixtureLines,
  });
  const savedLineFiveHash = await sha1(fixtureLines[4]);
  const repositionState = repositionDb.admSyncState.get("reposition-server");
  if (repositionState) {
    repositionState.last_processed_line = 10;
    repositionState.last_processed_adm_line_hash = savedLineFiveHash;
  }
  const repositionResult = await importReadableAdmLinesIntoDatabase(makeEnv(repositionDb), {
    context: { ...context, linkedServerId: "reposition-server", syncRunId: "reposition-recovery" },
    lines: fixtureLines,
  });
  assert.equal(repositionResult.report.cursorValidationStatus, "hash_found_repositioned");
  assert.equal(repositionResult.report.cursorRecoveryStrategy, "hash_found_repositioned");
  assert.equal(repositionDb.killEvents.filter((event) => event.linked_server_id === "reposition-server").length, 10);

  const outOfRangeDb = new MemoryD1();
  await importReadableAdmLinesIntoDatabase(makeEnv(outOfRangeDb), {
    context: { ...context, linkedServerId: "out-of-range-server", syncRunId: "out-of-range-initial" },
    lines: fixtureLines,
  });
  const outOfRangeState = outOfRangeDb.admSyncState.get("out-of-range-server");
  if (outOfRangeState) {
    outOfRangeState.last_processed_line = 999;
    outOfRangeState.last_processed_adm_line_hash = await sha1("missing line");
  }
  const outOfRangeResult = await importReadableAdmLinesIntoDatabase(makeEnv(outOfRangeDb), {
    context: { ...context, linkedServerId: "out-of-range-server", syncRunId: "out-of-range-recovery" },
    lines: fixtureLines,
  });
  assert.equal(outOfRangeResult.report.cursorValidationStatus, "line_out_of_range");
  assert.equal(outOfRangeResult.report.cursorRecoveryStrategy, "safe_tail_reprocess");
  assert.equal(outOfRangeDb.killEvents.filter((event) => event.linked_server_id === "out-of-range-server").length, 10);

  const failingDb = new MemoryD1({ failKillInsertAfter: 5 });
  const failingResult = await importReadableAdmLinesIntoDatabase(makeEnv(failingDb), {
    context: { ...context, syncRunId: "fixture-sync-run-fail" },
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(failingResult.status, "dzn_write_error");
  assert.equal(failingResult.report.failedWrites, 1);
  assert.equal(failingResult.report.cursorBefore, 0);
  assert.equal(failingResult.report.cursorAfter, 0);
  assert.equal(failingResult.report.cursorAdvanced, false);
  assert.equal(failingDb.admSyncState.get(linkedServerId)?.last_processed_line, 0);
  assert.equal(failingDb.admSyncState.get(linkedServerId)?.last_processed_adm_line_hash ?? null, null);

  failingDb.failKillInsertAfter = null;
  const recoveredResult = await importReadableAdmLinesIntoDatabase(makeEnv(failingDb), {
    context: { ...context, syncRunId: "fixture-sync-run-recovered" },
    lines: fixtureLines,
    guildId,
    planKey: "partner",
    publicServerName: "Fixture Server",
    updatePublicCache: true,
    queueDiscordPosts: true,
  });
  assert.equal(recoveredResult.status, "completed");
  assert.equal(failingDb.killEvents.length, 10);
  assert.equal(failingDb.admSyncState.get(linkedServerId)?.last_processed_line, 25);
  assert.equal(failingDb.serverStats.get(linkedServerId)?.total_kills, 10);
  assert.equal(failingDb.serverStats.get(linkedServerId)?.total_deaths, 13);

  console.log("ADM import pipeline fixture regression passed.", {
    fixtureDbKills: successDb.killEvents.length,
    fixtureSuicides: successDb.playerEvents.filter((event) => event.event_type === "player_suicide").length,
    fixtureUncreditedDeaths: successDb.playerEvents.filter((event) => event.event_type === "player_died_stats").length,
    cursorFailurePreserved: failingResult.report.cursorAdvanced === false,
    repeatedPairKillsStored: clusteredMustardKills.length,
    cursorHashStored: Boolean(successDb.admSyncState.get(linkedServerId)?.last_processed_adm_line_hash),
    cursorMismatchRecovered: mismatchResult.report.cursorValidationStatus,
    dashboardStatsKills: successDb.serverStats.get(linkedServerId)?.total_kills,
    publicCacheUpdated: successResult.report.publicCacheUpdated,
    discordQueuesCreated: successResult.report.discordQueuesCreated,
    bulkParsedKills: bulkResult.parsed_kills,
    bulkWrittenKills: bulkResult.written_kills,
    bulkDuplicateReimportWrittenKills: duplicateBulkResult.written_kills,
  });
}

function makeEnv(db: MemoryD1): Env {
  return { DB: db as unknown as D1Database } as Env;
}

function countBy(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function chunkAdmLines(lines: string[], chunkSize: number) {
  const chunks: Array<{ startLine: number; lines: string[] }> = [];
  for (let startLine = 0; startLine < lines.length; startLine += chunkSize) {
    chunks.push({ startLine, lines: lines.slice(startLine, startLine + chunkSize) });
  }
  return chunks;
}

async function importChunkedAdmText(
  env: Env,
  serverId: string,
  filename: string,
  admText: string,
  options: { chunkSize: number; importHitLines?: boolean },
) {
  const lines = admText.split(/\r?\n/).filter((line) => line.trim());
  const chunks = chunkAdmLines(lines, options.chunkSize);
  let progress = await startAdmImportLineJobForServer(env, {
    linkedServerId: serverId,
    filename,
    totalLines: lines.length,
    totalChunks: chunks.length,
    source: "manual_file_upload",
    chunkSize: options.chunkSize,
    importHitLines: options.importHitLines ?? false,
  });
  for (const [index, chunk] of chunks.entries()) {
    progress = await processAdmImportJobLineChunk(env, {
      linkedServerId: serverId,
      jobId: progress.job_id,
      filename,
      chunkIndex: index,
      startLine: chunk.startLine,
      lines: chunk.lines,
      previousLines: lines.slice(Math.max(0, chunk.startLine - 5), chunk.startLine),
    });
  }
  return await finishAdmImportLineJobForServer(env, { linkedServerId: serverId, jobId: progress.job_id });
}

async function sha1(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type RunResult = { meta: { changes: number } };
type MemoryValue = string | number | boolean | null | undefined;
type MemoryRow = Record<string, MemoryValue>;

class MemoryD1 {
  admRawEvents: MemoryRow[] = [];
  playerProfiles: MemoryRow[] = [];
  playerEvents: MemoryRow[] = [];
  killEvents: MemoryRow[] = [];
  buildEvents: MemoryRow[] = [];
  serverStats = new Map<string, MemoryRow>();
  serverBuildStats = new Map<string, MemoryRow>();
  admBuildReparseState = new Map<string, MemoryRow>();
  syncRuns: MemoryRow[] = [];
  admSyncState = new Map<string, MemoryRow>();
  serverPublicCache = new Map<string, MemoryRow>();
  automationJobs: MemoryRow[] = [];
  admImportJobs = new Map<string, MemoryRow>();
  linkedServers = new Map<string, MemoryRow>([[linkedServerId, {
    id: linkedServerId,
    user_id: "fixture-user",
    guild_id: guildId,
    nitrado_service_id: nitradoServiceId,
    server_name: "Fixture Server",
    display_name: "Fixture Server",
    hostname: "Fixture Server",
    nitrado_service_name: "Fixture Service",
    adm_path: null,
    plan_key: "partner",
    status: "live",
    subscription_status: "active",
  }]]);
  failKillInsertAfter: number | null;
  failAutomationJobInsert: boolean;
  killInsertAttempts = 0;

  constructor(options: { failKillInsertAfter?: number | null; failAutomationJobInsert?: boolean } = {}) {
    this.failKillInsertAfter = options.failKillInsertAfter ?? null;
    this.failAutomationJobInsert = options.failAutomationJobInsert ?? false;
  }

  prepare(query: string) {
    return new MemoryStatement(this, query);
  }
}

class MemoryStatement {
  private values: MemoryValue[] = [];

  constructor(private db: MemoryD1, private query: string) {}

  bind(...values: MemoryValue[]) {
    this.values = values;
    return this;
  }

  async run(): Promise<RunResult> {
    const q = normalizeSql(this.query);
    if (isSchemaQuery(q)) return changed(0);
    if (q.startsWith("update adm_raw_events") || q.startsWith("update player_events") || q.startsWith("update kill_events") || q.startsWith("update player_profiles") || q.startsWith("update server_stats") || q.startsWith("update adm_sync_state") || q.startsWith("update sync_runs")) return changed(0);
    if (q.includes("insert into adm_build_reparse_state")) {
      const row = {
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        adm_file: this.values[3],
        build_parser_version: this.values[4],
        status: "processing",
        last_line_processed: Number(this.values[5] ?? 0),
        raw_lines_scanned: 0,
        build_events_found: 0,
        build_events_added: 0,
        last_error: null,
        created_at: this.values[6],
        updated_at: this.values[7],
      };
      const existing = [...this.db.admBuildReparseState.values()].find((state) =>
        state.linked_server_id === row.linked_server_id &&
        state.source_service_id === row.source_service_id &&
        state.adm_file === row.adm_file &&
        state.build_parser_version === row.build_parser_version
      );
      if (existing) {
        existing.status = "processing";
        existing.last_line_processed = Math.max(Number(existing.last_line_processed ?? 0), Number(row.last_line_processed ?? 0));
        existing.last_error = null;
        existing.updated_at = row.updated_at;
      } else {
        this.db.admBuildReparseState.set(String(row.id), row);
      }
      return changed(1);
    }
    if (q.startsWith("update adm_build_reparse_state set")) {
      const row = this.db.admBuildReparseState.get(String(this.values[8]));
      if (!row) return changed(0);
      row.status = this.values[0];
      row.last_line_processed = Math.max(Number(row.last_line_processed ?? 0), Number(this.values[1] ?? 0));
      row.raw_lines_scanned = Number(row.raw_lines_scanned ?? 0) + Number(this.values[2] ?? 0);
      row.build_events_found = Number(row.build_events_found ?? 0) + Number(this.values[3] ?? 0);
      row.build_events_added = Number(row.build_events_added ?? 0) + Number(this.values[4] ?? 0);
      row.last_build_reparse_at = this.values[5];
      row.last_error = this.values[6];
      row.updated_at = this.values[7];
      return changed(1);
    }
    if (q.includes("insert or ignore into adm_raw_events")) return this.insertIgnore(this.db.admRawEvents, {
      id: this.values[0],
      linked_server_id: this.values[1],
      source_service_id: this.values[2],
      adm_file: this.values[3],
      source_adm_file: this.values[4],
      line_number: this.values[5],
      source_line_number: this.values[6],
      raw_line: this.values[8],
      event_type: this.values[9],
    });
    if (q.includes("insert into player_profiles")) {
      this.db.playerProfiles.push({
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        player_name: this.values[3],
        player_id: this.values[4],
        kills: 0,
        deaths: 0,
        suicides: 0,
        longest_kill_distance: 0,
        last_seen_at: this.values[5],
      });
      return changed(1);
    }
    if (q.startsWith("update player_profiles set player_name")) {
      const row = this.db.playerProfiles.find((profile) => profile.id === this.values[4]);
      if (!row) return changed(0);
      row.player_name = this.values[0];
      row.player_id = this.values[1] ?? row.player_id;
      row.source_service_id = row.source_service_id ?? this.values[2];
      row.last_seen_at = this.values[3] ?? row.last_seen_at;
      return changed(1);
    }
    if (q.startsWith("update player_profiles set kills")) {
      const row = this.db.playerProfiles.find((profile) => profile.id === this.values[1]);
      if (!row) return changed(0);
      row.kills = Number(row.kills ?? 0) + 1;
      row.longest_kill_distance = Math.max(Number(row.longest_kill_distance ?? 0), Number(this.values[0] ?? 0));
      return changed(1);
    }
    if (q.startsWith("update player_profiles set deaths")) {
      const row = this.db.playerProfiles.find((profile) => profile.id === this.values[1]);
      if (!row) return changed(0);
      row.deaths = Number(row.deaths ?? 0) + 1;
      row.suicides = Number(row.suicides ?? 0) + Number(this.values[0] ?? 0);
      return changed(1);
    }
    if (q.includes("insert or ignore into player_events")) return this.insertIgnore(this.db.playerEvents, {
      id: this.values[0],
      linked_server_id: this.values[1],
      source_service_id: this.values[2],
      player_profile_id: this.values[4],
      player_name: this.values[5],
      player_id: this.values[6],
      event_type: this.values[7],
      adm_file: this.values[11],
      source_adm_file: this.values[12],
      line_number: this.values[13],
      source_line_number: this.values[14],
      occurred_at: this.values[15],
      raw_line: this.values[16],
    });
    if (q.includes("insert or ignore into build_events")) return this.insertIgnore(this.db.buildEvents, {
      id: this.values[0],
      linked_server_id: this.values[1],
      nitrado_service_id: this.values[2],
      player_id: this.values[3],
      player_name: this.values[4],
      event_type: this.values[5],
      build_part: this.values[6],
      target_object: this.values[7],
      tool: this.values[8],
      placed_object: this.values[9],
      placed_class: this.values[10],
      source_adm_file: this.values[14],
      source_line_number: this.values[15],
      occurred_at: this.values[16],
      raw_line: this.values[17],
    });
    if (q.includes("insert or ignore into kill_events")) {
      this.db.killInsertAttempts += 1;
      if (this.db.failKillInsertAfter !== null && this.db.killInsertAttempts > this.db.failKillInsertAfter) {
        throw new Error("simulated kill_events write failure");
      }
      return this.insertIgnore(this.db.killEvents, {
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        killer_profile_id: this.values[4],
        victim_profile_id: this.values[5],
        killer_name: this.values[6],
        victim_name: this.values[7],
        killer_id: this.values[8],
        victim_id: this.values[9],
        weapon: this.values[10],
        distance: Number(this.values[11]),
        adm_file: this.values[15],
        source_adm_file: this.values[16],
        line_number: this.values[17],
        source_line_number: this.values[18],
        occurred_at: this.values[19],
        raw_line: this.values[20],
      });
    }
    if (q.includes("insert into server_stats")) {
      const linked = String(this.values[1]);
      const existing = this.db.serverStats.get(linked);
      const row = {
        linked_server_id: linked,
        source_service_id: this.values[2],
        total_kills: Number(this.values[3] ?? 0),
        total_deaths: Number(this.values[4] ?? 0),
        total_joins: Number(this.values[5] ?? 0),
        total_disconnects: Number(this.values[6] ?? 0),
        unique_players: Number(this.values[7] ?? 0),
        last_event_at: this.values[8] ?? null,
      };
      if (existing && q.includes("total_kills = total_kills +")) {
        existing.total_kills = Number(existing.total_kills ?? 0) + Number(row.total_kills ?? 0);
        existing.total_deaths = Number(existing.total_deaths ?? 0) + Number(row.total_deaths ?? 0);
        existing.total_joins = Number(existing.total_joins ?? 0) + Number(row.total_joins ?? 0);
        existing.total_disconnects = Number(existing.total_disconnects ?? 0) + Number(row.total_disconnects ?? 0);
        existing.unique_players = row.unique_players;
        existing.last_event_at = row.last_event_at ?? existing.last_event_at;
      } else {
        this.db.serverStats.set(linked, row);
      }
      return changed(1);
    }
    if (q.includes("insert into server_build_stats")) {
      this.db.serverBuildStats.set(String(this.values[0]), {
        linked_server_id: this.values[0],
        nitrado_service_id: this.values[1],
        structures_built: Number(this.values[2] ?? 0),
        build_items_placed: Number(this.values[3] ?? 0),
        storage_items_placed: Number(this.values[4] ?? 0),
        traps_placed: Number(this.values[5] ?? 0),
        build_score: Number(this.values[6] ?? 0),
        top_builder_name: this.values[7],
        top_builder_count: Number(this.values[8] ?? 0),
        last_build_at: this.values[9],
      });
      return changed(1);
    }
    if (q.includes("insert into adm_sync_state")) {
      const linked = String(this.values[1]);
      this.db.admSyncState.set(linked, {
        linked_server_id: linked,
        latest_adm_file: this.values[3],
        latest_adm_path: this.values[4],
        last_processed_file: this.values[5],
        last_processed_line: Number(this.values[6] ?? 0),
        last_processed_offset: Number(this.values[7] ?? 0),
        last_sync_status: this.values[8],
        last_sync_message: this.values[9],
        last_sync_at: this.values[10],
        last_lines_read: Number(this.values[11] ?? 0),
        last_lines_processed: Number(this.values[12] ?? 0),
        last_raw_events_stored: Number(this.values[13] ?? 0),
        last_player_events_stored: Number(this.values[14] ?? 0),
        last_kill_events_stored: Number(this.values[15] ?? 0),
        last_events_created: Number(this.values[16] ?? 0),
        last_kills_created: Number(this.values[17] ?? 0),
        last_unknown_lines: Number(this.values[18] ?? 0),
        last_duplicate_lines: Number(this.values[19] ?? 0),
        last_import_report_json: this.values[27],
        last_processed_adm_line_hash: this.values[28],
        last_processed_adm_line_text_preview: this.values[29],
        last_cursor_validation_status: this.values[30],
        last_cursor_validation_error: this.values[31],
        last_cursor_validation_at: this.values[32],
        cursor_recovery_strategy: this.values[33],
        cursor_recovery_reason: this.values[34],
      });
      return changed(1);
    }
    if (q.includes("insert into adm_import_jobs")) {
      const chunkProtocol = q.includes("import_hit_lines");
      this.db.admImportJobs.set(String(this.values[0]), {
        id: this.values[0],
        server_id: this.values[1],
        source_service_id: this.values[2],
        filename: this.values[3],
        source: this.values[4],
        status: "queued",
        adm_text: chunkProtocol ? "" : this.values[5],
        total_lines: Number(this.values[chunkProtocol ? 5 : 6] ?? 0),
        current_line: 0,
        chunk_size: Number(this.values[chunkProtocol ? 6 : 7] ?? 25),
        total_chunks: Number(this.values[chunkProtocol ? 7 : 8] ?? 1),
        chunks_processed: 0,
        import_hit_lines: chunkProtocol ? this.values[8] : 0,
        raw_kill_lines_found: 0,
        last_chunk_index: -1,
        failed_chunk_index: null,
        parsed_kills: 0,
        written_kills: 0,
        duplicate_skips: 0,
        joins: 0,
        disconnects: 0,
        playerlist_snapshots: 0,
        deaths: 0,
        suicides: 0,
        uncredited_deaths: 0,
        hit_lines: 0,
        raw_events: 0,
        player_events: 0,
        failed_writes: 0,
        public_cache_updated: 0,
        discord_jobs_queued: 0,
        warnings_json: "[]",
        error_message: null,
        result_json: null,
        created_at: this.values[chunkProtocol ? 9 : 9],
        updated_at: this.values[chunkProtocol ? 10 : 10],
        completed_at: null,
      });
      return changed(1);
    }
    if (q.startsWith("update adm_import_jobs set status = 'writing'")) {
      const row = this.db.admImportJobs.get(String(this.values[1]));
      if (!row) return changed(0);
      row.status = "writing";
      row.error_message = null;
      row.updated_at = this.values[0];
      return changed(1);
    }
    if (q.startsWith("update adm_import_jobs set") && q.includes("status = case") && q.includes("current_line = total_lines")) {
      let changes = 0;
      const source = String(this.values[2] ?? "");
      const cutoff = String(this.values[3] ?? "");
      for (const row of this.db.admImportJobs.values()) {
        const updatedAt = String(row.updated_at ?? row.created_at ?? "");
        if (
          row.source === source &&
          ["processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(String(row.status)) &&
          Number(row.total_lines ?? 0) > 0 &&
          Number(row.current_line ?? 0) >= Number(row.total_lines ?? 0) &&
          updatedAt < cutoff
        ) {
          row.status = Number(row.failed_writes ?? 0) > 0 || String(row.warnings_json ?? "[]") !== "[]" || row.error_message ? "completed_with_warnings" : "completed";
          row.error_message = null;
          row.current_line = Number(row.total_lines ?? row.current_line);
          row.chunks_processed = Number(row.total_chunks ?? row.chunks_processed);
          row.completed_at = row.completed_at ?? row.updated_at ?? this.values[0];
          row.updated_at = this.values[1];
          changes += 1;
        }
      }
      return changed(changes);
    }
    if (q.includes("scheduled adm import job stalled")) {
      let changes = 0;
      const source = String(this.values[1] ?? "");
      const cutoff = String(this.values[2] ?? "");
      for (const row of this.db.admImportJobs.values()) {
        const updatedAt = String(row.updated_at ?? row.created_at ?? "");
        if (
          row.source === source &&
          ["processing", "parsing", "writing", "rebuilding"].includes(String(row.status)) &&
          updatedAt < cutoff
        ) {
          row.status = "failed_retryable";
          row.error_message = row.error_message ?? "Scheduled ADM import job stalled for more than 5 minutes. Cron or dashboard Continue Import can retry it automatically.";
          row.chunk_size = Number(row.chunk_size ?? 0) > 50 ? 50 : Number(row.chunk_size ?? 0) > 25 ? 25 : row.chunk_size;
          row.updated_at = this.values[0];
          changes += 1;
        }
      }
      return changed(changes);
    }
    if (q.startsWith("update adm_import_jobs set status = 'failed'") || q.startsWith("update adm_import_jobs set status = 'failed_retryable'")) {
      const chunkProtocol = q.includes("failed_chunk_index");
      const row = this.db.admImportJobs.get(String(this.values[chunkProtocol ? 3 : 2]));
      if (!row) return changed(0);
      row.status = q.startsWith("update adm_import_jobs set status = 'failed_retryable'") ? "failed_retryable" : "failed";
      row.error_message = this.values[0];
      if (chunkProtocol) row.failed_chunk_index = this.values[1];
      row.failed_writes = Number(row.failed_writes ?? 0) + 1;
      row.updated_at = this.values[chunkProtocol ? 2 : 1];
      return changed(1);
    }
    if (q.startsWith("update adm_import_jobs set status = 'cancelled'")) {
      const row = this.db.admImportJobs.get(String(this.values[1]));
      if (!row) return changed(0);
      row.status = "cancelled";
      row.error_message = row.error_message ?? "ADM import cancelled by owner/admin. Already written events were preserved.";
      row.updated_at = this.values[0];
      return changed(1);
    }
    if (q.startsWith("update adm_import_jobs set status = 'rebuilding'")) {
      const row = this.db.admImportJobs.get(String(this.values[1]));
      if (!row) return changed(0);
      row.status = "rebuilding";
      row.updated_at = this.values[0];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set") && q.includes("adm_text = ?") && q.includes("total_lines = ?")) {
      const row = this.db.admImportJobs.get(String(this.values[8]));
      if (!row) return changed(0);
      row.status = this.values[0];
      row.adm_text = this.values[1];
      row.total_lines = Number(this.values[2] ?? row.total_lines);
      row.current_line = Number(this.values[3] ?? row.current_line);
      row.chunk_size = Number(this.values[4] ?? row.chunk_size);
      row.total_chunks = Number(this.values[5] ?? row.total_chunks);
      row.chunks_processed = Number(this.values[6] ?? row.chunks_processed);
      row.completed_at = null;
      row.error_message = null;
      row.failed_chunk_index = null;
      row.updated_at = this.values[7];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set adm_text = ''")) {
      return changed(0);
    }
    if (q.startsWith("update adm_import_jobs set status = 'queued'") && q.includes("failed_chunk_index = null") && !q.includes("parsed_kills") && !q.includes("current_line")) {
      const row = this.db.admImportJobs.get(String(this.values[1]));
      if (!row) return changed(0);
      row.status = "queued";
      row.error_message = null;
      row.failed_chunk_index = null;
      row.updated_at = this.values[0];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set") && q.includes("failed_writes = failed_writes + 1") && q.includes("current_line = ?") && !q.includes("parsed_kills")) {
      const row = this.db.admImportJobs.get(String(this.values[5]));
      if (!row) return changed(0);
      row.status = "queued";
      row.current_line = Number(this.values[0] ?? row.current_line);
      row.chunks_processed = Number(this.values[1] ?? row.chunks_processed);
      row.failed_writes = Number(row.failed_writes ?? 0) + 1;
      row.warnings_json = this.values[2];
      row.last_chunk_index = this.values[3];
      row.failed_chunk_index = null;
      row.error_message = null;
      row.updated_at = this.values[4];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set") && q.includes("parsed_kills = parsed_kills +")) {
      const chunkProtocol = q.includes("raw_kill_lines_found = raw_kill_lines_found +");
      const hasStatusParam = q.includes("status = ?");
      const rowIdIndex = chunkProtocol ? (hasStatusParam ? 20 : 19) : 18;
      const row = this.db.admImportJobs.get(String(this.values[rowIdIndex]));
      if (!row) return changed(0);
      row.status = hasStatusParam ? this.values[0] : (chunkProtocol ? "queued" : this.values[0]);
      row.current_line = Number(this.values[chunkProtocol ? (hasStatusParam ? 1 : 0) : 1] ?? row.current_line);
      row.chunks_processed = Number(this.values[chunkProtocol ? (hasStatusParam ? 2 : 1) : 2] ?? row.chunks_processed);
      let offset = 3;
      if (chunkProtocol) {
        row.raw_kill_lines_found = Number(row.raw_kill_lines_found ?? 0) + Number(this.values[hasStatusParam ? 3 : 2] ?? 0);
        row.last_chunk_index = this.values[hasStatusParam ? 4 : 3];
        row.failed_chunk_index = null;
        offset = hasStatusParam ? 5 : 4;
      }
      row.parsed_kills = Number(row.parsed_kills ?? 0) + Number(this.values[offset] ?? 0);
      row.written_kills = Number(row.written_kills ?? 0) + Number(this.values[offset + 1] ?? 0);
      row.duplicate_skips = Number(row.duplicate_skips ?? 0) + Number(this.values[offset + 2] ?? 0);
      row.joins = Number(row.joins ?? 0) + Number(this.values[offset + 3] ?? 0);
      row.disconnects = Number(row.disconnects ?? 0) + Number(this.values[offset + 4] ?? 0);
      row.playerlist_snapshots = Number(row.playerlist_snapshots ?? 0) + Number(this.values[offset + 5] ?? 0);
      row.deaths = Number(row.deaths ?? 0) + Number(this.values[offset + 6] ?? 0);
      row.suicides = Number(row.suicides ?? 0) + Number(this.values[offset + 7] ?? 0);
      row.uncredited_deaths = Number(row.uncredited_deaths ?? 0) + Number(this.values[offset + 8] ?? 0);
      row.hit_lines = Number(row.hit_lines ?? 0) + Number(this.values[offset + 9] ?? 0);
      row.raw_events = Number(row.raw_events ?? 0) + Number(this.values[offset + 10] ?? 0);
      row.player_events = Number(row.player_events ?? 0) + Number(this.values[offset + 11] ?? 0);
      row.failed_writes = Number(row.failed_writes ?? 0) + Number(this.values[offset + 12] ?? 0);
      row.warnings_json = this.values[offset + 13];
      row.updated_at = this.values[offset + 14];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set") && q.includes("current_line = total_lines") && q.includes("result_json = ?")) {
      const usesDynamicStatus = q.includes("status = ?");
      const hasChunkTotals = q.includes("total_chunks = ?");
      const row = this.db.admImportJobs.get(String(this.values[usesDynamicStatus ? (hasChunkTotals ? 9 : 7) : 6]));
      if (!row) return changed(0);
      row.status = usesDynamicStatus ? this.values[0] : "completed";
      row.current_line = row.total_lines;
      const offset = usesDynamicStatus ? (hasChunkTotals ? 3 : 1) : 0;
      if (hasChunkTotals) {
        row.total_chunks = Number(this.values[1] ?? row.total_chunks);
        row.chunks_processed = Number(this.values[2] ?? row.total_chunks);
      } else {
        row.chunks_processed = row.total_chunks;
      }
      row.public_cache_updated = this.values[offset];
      row.discord_jobs_queued = this.values[offset + 1];
      row.warnings_json = this.values[offset + 2];
      row.result_json = this.values[offset + 3];
      row.completed_at = this.values[offset + 4];
      row.updated_at = this.values[offset + 5];
      return changed(1);
    }
    if (q.includes("update adm_sync_state set last_import_report_json")) {
      const row = this.db.admSyncState.get(String(this.values[1]));
      if (!row) return changed(0);
      row.last_import_report_json = this.values[0];
      return changed(1);
    }
    if (q.includes("insert into sync_runs")) {
      this.db.syncRuns.push({
        id: this.values[0],
        linked_server_id: this.values[1],
        source_service_id: this.values[2],
        trigger_type: this.values[3],
        status: this.values[4],
        message: this.values[5],
        lines_read: this.values[6],
        lines_processed: this.values[7],
        events_created: this.values[8],
        kills_created: this.values[9],
      });
      return changed(1);
    }
    if (q.includes("insert into server_public_cache")) {
      this.db.serverPublicCache.set(String(this.values[1]), {
        guild_id: this.values[1],
        plan_key: this.values[2],
        public_server_name: this.values[3],
        last_status_update_at: this.values[12],
        last_adm_update_at: this.values[13],
      });
      return changed(1);
    }
    if (q.startsWith("update automation_jobs set")) return changed(0);
    if (q.includes("insert or ignore into automation_jobs")) {
      if (this.db.failAutomationJobInsert) throw new Error("simulated automation_jobs write failure");
      return this.insertIgnore(this.db.automationJobs, {
      id: this.values[0],
      guild_id: this.values[1],
      post_type: this.values[2],
      status: "queued",
      last_error: this.values[3],
      }, (row) => row.guild_id === this.values[1] && row.post_type === this.values[2]);
    }
    return changed(0);
  }

  async first<T>(): Promise<T | null> {
    const q = normalizeSql(this.query);
    if (q.includes("from adm_import_jobs")) {
      if (q.includes("where server_id = ? and filename = ?")) {
        const rows = Array.from(this.db.admImportJobs.values())
          .filter((row) => row.server_id === this.values[0] && row.filename === this.values[1])
          .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")));
        return (rows[0] ?? null) as T | null;
      }
      if (q.includes("status in")) {
        const rows = Array.from(this.db.admImportJobs.values())
          .filter((row) => row.server_id === this.values[0] && ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(String(row.status)))
          .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")));
        return (rows[0] ?? null) as T | null;
      }
      const row = this.db.admImportJobs.get(String(this.values[0]));
      return (row && row.server_id === this.values[1] ? row : null) as T | null;
    }
    if (q.includes("from adm_build_reparse_state state")) {
      const parserVersion = String(this.values[0] ?? "");
      const rows = [...this.db.admBuildReparseState.values()]
        .filter((row) => row.build_parser_version === parserVersion && ["queued", "processing", "failed_retryable"].includes(String(row.status)))
        .sort((a, b) => String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? "")));
      const row = rows[0];
      if (!row) return null;
      const server = this.db.linkedServers.get(String(row.linked_server_id));
      return ({
        ...row,
        server_name: server?.display_name ?? server?.hostname ?? server?.server_name ?? server?.nitrado_service_name ?? null,
      } as T);
    }
    if (q.includes("from adm_raw_events raw") && q.includes("left join adm_build_reparse_state")) {
      const parserVersion = String(this.values[0] ?? "");
      const cutoff = String(this.values[1] ?? "");
      const candidates = this.db.admRawEvents
        .filter((raw) => String(raw.created_at ?? "9999") >= cutoff)
        .map((raw) => {
          const server = this.db.linkedServers.get(String(raw.linked_server_id));
          const sourceServiceId = raw.source_service_id ?? server?.nitrado_service_id ?? null;
          const admFile = raw.source_adm_file ?? raw.adm_file ?? null;
          const state = [...this.db.admBuildReparseState.values()].find((existing) =>
            existing.linked_server_id === raw.linked_server_id &&
            existing.source_service_id === sourceServiceId &&
            existing.adm_file === admFile &&
            existing.build_parser_version === parserVersion
          );
          return { raw, server, sourceServiceId, admFile, state };
        })
        .filter(({ raw, server, sourceServiceId, admFile, state }) =>
          Boolean(sourceServiceId && admFile) &&
          String(server?.status ?? "").toLowerCase() === "live" &&
          !(server?.merged_into_server_id) &&
          state?.status !== "completed" &&
          raw.linked_server_id
        );
      const grouped = new Map<string, MemoryRow & { last_raw_at: string }>();
      for (const { raw, server, sourceServiceId, admFile } of candidates) {
        const key = `${raw.linked_server_id}:${sourceServiceId}:${admFile}`;
        const lastRawAt = String(raw.created_at ?? "");
        const existing = grouped.get(key);
        if (existing && String(existing.last_raw_at ?? "").localeCompare(lastRawAt) >= 0) continue;
        grouped.set(key, {
          linked_server_id: String(raw.linked_server_id),
          source_service_id: String(sourceServiceId),
          adm_file: String(admFile),
          last_line_processed: 0,
          server_name: String(server?.display_name ?? server?.hostname ?? server?.server_name ?? server?.nitrado_service_name ?? "Fixture Server"),
          last_raw_at: lastRawAt,
        });
      }
      const row = [...grouped.values()].sort((a, b) => String(a.last_raw_at).localeCompare(String(b.last_raw_at)))[0];
      return (row ?? null) as T | null;
    }
    if (q.includes("from adm_sync_state") && q.includes("select *")) return (this.db.admSyncState.get(String(this.values[0])) ?? null) as T | null;
    if (q.includes("select last_import_report_json from adm_sync_state")) return ({ last_import_report_json: this.db.admSyncState.get(String(this.values[0]))?.last_import_report_json ?? null } as T);
    if (q.includes("from linked_servers") && q.includes("server_subscriptions.plan_key")) return (this.db.linkedServers.get(String(this.values[0])) ?? null) as T | null;
    if (q.includes("from linked_servers") && q.includes("where linked_servers.id = ?") && q.includes("linked_servers.user_id = ?")) {
      const row = this.db.linkedServers.get(String(this.values[0]));
      return (row && row.user_id === this.values[1] ? row : null) as T | null;
    }
    if (q.includes("select guild_id, plan_key") && q.includes("from linked_servers")) return (this.db.linkedServers.get(String(this.values[0])) ?? null) as T | null;
    if (q.includes("select nitrado_service_id from linked_servers")) return (this.db.linkedServers.get(String(this.values[0])) ?? { nitrado_service_id: null }) as T;
    if (q.includes("from player_profiles") && q.includes("player_id = ?")) {
      return (this.db.playerProfiles.find((profile) => profile.linked_server_id === this.values[0] && profile.player_id === this.values[1]) ?? null) as T | null;
    }
    if (q.includes("from player_profiles") && q.includes("lower(player_name)")) {
      return (this.db.playerProfiles.find((profile) => profile.linked_server_id === this.values[0] && String(profile.player_name).toLowerCase() === String(this.values[1]).toLowerCase()) ?? null) as T | null;
    }
    if (q.includes("from player_events") && q.includes("source_line_number")) {
      return (this.db.playerEvents.find((event) =>
        event.linked_server_id === this.values[0] &&
        event.source_service_id === this.values[2] &&
        event.source_adm_file === this.values[3] &&
        Number(event.source_line_number) === Number(this.values[4])
      ) ?? null) as T | null;
    }
    if (q.includes("from kill_events") && q.includes("coalesce(occurred_at")) {
      return (this.db.killEvents.find((event) =>
        event.linked_server_id === this.values[0] &&
        event.source_service_id === this.values[2] &&
        event.occurred_at === this.values[3] &&
        (event.killer_id ?? event.killer_name) === this.values[4] &&
        (event.victim_id ?? event.victim_name) === this.values[5] &&
        event.weapon === this.values[6] &&
        Math.abs(Number(event.distance ?? -9999999) - Number(this.values[8] ?? -9999999)) < 0.0001
      ) ?? null) as T | null;
    }
    if (q.includes("count(*) as count from player_profiles")) return ({ count: this.db.playerProfiles.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from adm_raw_events") && q.includes("source_line_number")) {
      return ({ count: this.db.admRawEvents.filter((row) =>
        row.linked_server_id === this.values[0] &&
        (row.source_service_id ?? this.values[1]) === this.values[2] &&
        (row.source_adm_file ?? row.adm_file) === this.values[3] &&
        Number(row.source_line_number ?? row.line_number ?? 0) > Number(this.values[4] ?? 0)
      ).length } as T);
    }
    if (q.includes("count(*) as count from adm_raw_events")) return ({ count: this.db.admRawEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from player_events") && q.includes("event_type in")) {
      const deathTypes = new Set(["player_suicide", "player_killed_environment", "player_died_stats"]);
      return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0] && deathTypes.has(String(row.event_type))).length } as T);
    }
    if (q.includes("count(*) as count from player_events") && q.includes("event_type = 'player_connected'")) return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0] && row.event_type === "player_connected").length } as T);
    if (q.includes("count(*) as count from player_events") && q.includes("event_type = 'player_disconnected'")) return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0] && row.event_type === "player_disconnected").length } as T);
    if (q.includes("count(*) as count from player_events")) return ({ count: this.db.playerEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from build_events")) return ({ count: this.db.buildEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("count(*) as count from kill_events") && q.includes("victim_name is not null")) return ({ count: this.db.killEvents.filter((row) => row.linked_server_id === this.values[0] && row.victim_name).length } as T);
    if (q.includes("count(*) as count from kill_events")) return ({ count: this.db.killEvents.filter((row) => row.linked_server_id === this.values[0]).length } as T);
    if (q.includes("max(coalesce(distance")) return ({ distance: maxNumber(this.db.killEvents.filter((row) => row.linked_server_id === this.values[0]).map((row) => Number(row.distance ?? 0))) } as T);
    if (q.includes("select max(coalesce(occurred_at")) return ({ last_event_at: latestTime([...this.db.playerEvents, ...this.db.killEvents, ...this.db.buildEvents].filter((row) => row.linked_server_id === this.values[0] || row.linked_server_id === this.values[1] || row.linked_server_id === this.values[2])) } as T);
    if (q.includes("sum(case when event_type")) {
      const rows = this.db.buildEvents.filter((row) => row.linked_server_id === this.values[0]);
      const structuresBuilt = rows.filter((row) => row.event_type === "built" && isStructurePartForMemory(row.build_part)).length;
      const buildItemsPlaced = rows.filter((row) => row.event_type === "placed" && ["fencekit", "watchtowerkit", "territoryflagkit", "flagpolekit", "shelterkit"].includes(String(row.placed_class ?? "").toLowerCase())).length;
      const storageItemsPlaced = rows.filter((row) => row.event_type === "placed" && /^(woodencrate|barrel|seachest|tent|mediumtent|largetent|cartent)/i.test(String(row.placed_class ?? ""))).length;
      const trapsPlaced = rows.filter((row) => row.event_type === "placed" && ["landminetrap", "beartrap", "tripwiretrap"].includes(String(row.placed_class ?? "").toLowerCase())).length;
      const buildScore = rows.reduce((score, row) => score + scoreBuildEventForMemory(row), 0);
      return ({
        structures_built: structuresBuilt,
        build_items_placed: buildItemsPlaced,
        storage_items_placed: storageItemsPlaced,
        traps_placed: trapsPlaced,
        build_score: buildScore,
        last_build_at: latestTime(rows),
      } as T);
    }
    if (q.includes("select player_name, count(*) as count") && q.includes("from build_events")) {
      const rows = this.db.buildEvents.filter((row) => row.linked_server_id === this.values[0] && ["built", "placed"].includes(String(row.event_type)) && row.player_name);
      if (!rows.length) return null;
      const counts = new Map<string, { player_name: string; count: number }>();
      for (const row of rows) {
        const key = String(row.player_id ?? row.player_name).toLowerCase();
        const current = counts.get(key) ?? { player_name: String(row.player_name), count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
      return ([...counts.values()].sort((a, b) => b.count - a.count)[0] ?? null) as T | null;
    }
    if (q.includes("from adm_sync_file_state")) return ({ count: 0 } as T);
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const q = normalizeSql(this.query);
    if (q.startsWith("pragma table_info")) return { results: [] };
    if (q.includes("from adm_raw_events") && q.includes("order by coalesce(source_line_number")) {
      const rows = this.db.admRawEvents
        .filter((row) =>
          row.linked_server_id === this.values[0] &&
          (row.source_service_id ?? this.values[1]) === this.values[2] &&
          (row.source_adm_file ?? row.adm_file) === this.values[3] &&
          Number(row.source_line_number ?? row.line_number ?? 0) > Number(this.values[4] ?? 0)
        )
        .sort((a, b) => Number(a.source_line_number ?? a.line_number ?? 0) - Number(b.source_line_number ?? b.line_number ?? 0))
        .slice(0, Number(this.values[5] ?? 100));
      return { results: rows as T[] };
    }
    if (q.includes("from adm_import_jobs")) {
      const source = String(this.values[0] ?? "");
      const linkedServerFilter = this.values[1] === null || this.values[1] === undefined ? null : String(this.values[1]);
      const activeStaleCutoff = this.values.length >= 5 ? String(this.values[3] ?? "") : null;
      const limit = Number(this.values.length >= 5 ? this.values[4] : this.values[1] ?? 5);
      const rows = Array.from(this.db.admImportJobs.values())
        .filter((row) => {
          if (row.source !== source) return false;
          if (linkedServerFilter && row.server_id !== linkedServerFilter) return false;
          if (["queued", "failed_retryable"].includes(String(row.status))) return true;
          if (!["processing", "parsing", "writing", "rebuilding"].includes(String(row.status))) return false;
          if (!activeStaleCutoff) return true;
          return String(row.updated_at ?? row.created_at ?? "") < activeStaleCutoff;
        })
        .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
        .slice(0, limit);
      return { results: rows as T[] };
    }
    if (q.includes("select source, event_type") && q.includes("from kill_events") && q.includes("union all")) {
      const linkedServer = String(this.values[0]);
      const limit = Number(this.values.at(-1) ?? 10);
      const rows = [
        ...this.db.killEvents
          .filter((event) => event.linked_server_id === linkedServer)
          .map((event) => ({
            source: "kill",
            event_type: "player_killed",
            player_name: null,
            killer_name: event.killer_name ?? null,
            victim_name: event.victim_name ?? null,
            weapon: event.weapon ?? null,
            distance: event.distance ?? null,
            occurred_at: event.occurred_at ?? null,
            created_at: event.created_at ?? event.occurred_at ?? null,
            raw_line: event.raw_line ?? null,
            event_priority: 0,
            sort_time: event.occurred_at ?? event.created_at ?? "",
          })),
        ...this.db.playerEvents
          .filter((event) => event.linked_server_id === linkedServer && !String(event.event_type ?? "").startsWith("player_hit"))
          .map((event) => ({
            source: "player",
            event_type: event.event_type ?? "unknown",
            player_name: event.player_name ?? null,
            killer_name: null,
            victim_name: null,
            weapon: null,
            distance: null,
            occurred_at: event.occurred_at ?? null,
            created_at: event.created_at ?? event.occurred_at ?? null,
            raw_line: event.raw_line ?? null,
            event_priority: ["player_suicide", "player_killed_environment", "player_died_stats"].includes(String(event.event_type)) ? 1 : ["player_connected", "player_disconnected", "playerlist_snapshot"].includes(String(event.event_type)) ? 2 : 3,
            sort_time: event.occurred_at ?? event.created_at ?? "",
          })),
      ]
        .sort((a, b) => Number(a.event_priority) - Number(b.event_priority) || String(b.sort_time).localeCompare(String(a.sort_time)))
        .slice(0, limit);
      return { results: rows as T[] };
    }
    return { results: [] };
  }

  private insertIgnore(rows: MemoryRow[], row: MemoryRow, predicate: (row: MemoryRow) => boolean = (existing) => existing.id === row.id): RunResult {
    if (rows.some(predicate)) return changed(0);
    rows.push(row);
    return changed(1);
  }
}

function normalizeSql(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isSchemaQuery(query: string) {
  return query.startsWith("create ") || query.startsWith("alter table") || query.startsWith("pragma ") || query.startsWith("create unique index") || query.startsWith("create index");
}

function changed(changes: number): RunResult {
  return { meta: { changes } };
}

function maxNumber(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function latestTime(rows: MemoryRow[]) {
  const values = rows.map((row) => row.occurred_at ?? row.created_at).filter(Boolean).sort();
  return values.at(-1) ?? null;
}

function isStructurePartForMemory(value: MemoryValue) {
  const part = String(value ?? "").toLowerCase();
  return [
    "base",
    "wall_gate",
    "wall_platform",
    "level_1_base",
    "level_1_roof",
    "level_1_stairs",
    "level_2_base",
    "level_2_roof",
    "level_2_stairs",
    "level_3_base",
    "level_3_roof",
    "level_3_stairs",
  ].includes(part) || /^wall_(base|wood|metal)_(up|down)$/.test(part) || /^level_[123]_wall_\d+_(base|wood|metal)_(up|down)$/.test(part);
}

function scoreBuildEventForMemory(row: MemoryRow) {
  const eventType = String(row.event_type ?? "");
  const buildPart = String(row.build_part ?? "").toLowerCase();
  const placedClass = String(row.placed_class ?? "").toLowerCase();
  if (eventType === "built") {
    if (buildPart === "wall_gate") return 15;
    if (buildPart === "base") return 12;
    if (buildPart.startsWith("wall_metal_")) return 12;
    return isStructurePartForMemory(buildPart) ? 10 : 0;
  }
  if (eventType !== "placed") return 0;
  if (["fencekit", "watchtowerkit", "territoryflagkit", "flagpolekit", "shelterkit"].includes(placedClass)) return 5;
  if (/^(woodencrate|barrel|seachest|tent|mediumtent|largetent|cartent)/i.test(placedClass)) return 3;
  if (["landminetrap", "beartrap", "tripwiretrap", "spotlight", "constructionlight"].includes(placedClass)) return 1;
  return 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
