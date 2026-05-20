import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createAdmImportJobForServer,
  getRecentAdmSyncEvents,
  importAdmFilesForServer,
  importAdmTextForServer,
  importReadableAdmLinesIntoDatabase,
  processNextAdmImportJobChunk,
  previewManualAdmText,
  type AdmSyncContext,
} from "../functions/_lib/adm-sync";
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
  const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
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
  assert.match(dashboardSource, /createAdmImportJob/);
  assert.match(dashboardSource, /processAdmImportJob/);
  assert.match(dashboardSource, /for \(const \[index, file\] of files\.entries\(\)\)/);
  assert.match(dashboardSource, /Retry this file/);
  assert.match(dashboardSource, /refreshDashboardAfterManualAdmImport\(\)/);
  assert.match(forceLatestEndpointSource, /runAdmSync/);
  assert.match(forceLatestEndpointSource, /requireServerOwnerOrDznAdmin/);

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
    let progress = await createAdmImportJobForServer(makeEnv(chunkedDb), {
      linkedServerId,
      filename: file.filename,
      admText: file.admText,
      source: "manual_file_upload",
      chunkSize: 25,
    });
    while (progress.status !== "completed") {
      progress = await processNextAdmImportJobChunk(makeEnv(chunkedDb), {
        linkedServerId,
        jobId: progress.job_id,
      });
    }
    assert.equal(progress.file_result?.status, "imported");
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

  const duplicateChunkedResults = [];
  for (const file of bulkFixtureFiles) {
    let progress = await createAdmImportJobForServer(makeEnv(chunkedDb), {
      linkedServerId,
      filename: file.filename,
      admText: file.admText,
      source: "manual_file_upload",
      chunkSize: 25,
    });
    while (progress.status !== "completed") {
      progress = await processNextAdmImportJobChunk(makeEnv(chunkedDb), {
        linkedServerId,
        jobId: progress.job_id,
      });
    }
    duplicateChunkedResults.push(progress.file_result);
  }
  assert.equal(duplicateChunkedResults.reduce((total, file) => total + Number(file?.written_kills ?? 0), 0), 0);
  assert.equal(duplicateChunkedResults.reduce((total, file) => total + Number(file?.duplicate_skips ?? 0), 0) >= 55, true);
  assert.equal(chunkedDb.killEvents.length, 55);

  const chunkRetryDb = new MemoryD1({ failKillInsertAfter: 0 });
  let retryProgress = await createAdmImportJobForServer(makeEnv(chunkRetryDb), {
    linkedServerId,
    filename: latestFixtureName,
    admText: readFileSync(`scripts/fixtures/${latestFixtureName}`, "utf8"),
    source: "manual_file_upload",
    chunkSize: 25,
  });
  await assert.rejects(
    () => processNextAdmImportJobChunk(makeEnv(chunkRetryDb), { linkedServerId, jobId: retryProgress.job_id }),
    /simulated kill_events write failure/,
  );
  assert.equal(chunkRetryDb.admImportJobs.get(retryProgress.job_id)?.current_line, 0);
  chunkRetryDb.failKillInsertAfter = null;
  while (retryProgress.status !== "completed") {
    retryProgress = await processNextAdmImportJobChunk(makeEnv(chunkRetryDb), {
      linkedServerId,
      jobId: retryProgress.job_id,
    });
  }
  assert.equal(retryProgress.file_result?.parsed_kills, 5);
  assert.equal(retryProgress.file_result?.written_kills, 5);
  assert.equal(chunkRetryDb.killEvents.length, 5);

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
      this.db.serverBuildStats.set(String(this.values[0]), { linked_server_id: this.values[0] });
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
      this.db.admImportJobs.set(String(this.values[0]), {
        id: this.values[0],
        server_id: this.values[1],
        source_service_id: this.values[2],
        filename: this.values[3],
        source: this.values[4],
        status: "queued",
        adm_text: this.values[5],
        total_lines: Number(this.values[6] ?? 0),
        current_line: 0,
        chunk_size: Number(this.values[7] ?? 25),
        total_chunks: Number(this.values[8] ?? 1),
        chunks_processed: 0,
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
        created_at: this.values[9],
        updated_at: this.values[10],
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
    if (q.startsWith("update adm_import_jobs set status = 'failed'")) {
      const row = this.db.admImportJobs.get(String(this.values[2]));
      if (!row) return changed(0);
      row.status = "failed";
      row.error_message = this.values[0];
      row.failed_writes = Number(row.failed_writes ?? 0) + 1;
      row.updated_at = this.values[1];
      return changed(1);
    }
    if (q.startsWith("update adm_import_jobs set status = 'rebuilding'")) {
      const row = this.db.admImportJobs.get(String(this.values[1]));
      if (!row) return changed(0);
      row.status = "rebuilding";
      row.updated_at = this.values[0];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set") && q.includes("parsed_kills = parsed_kills +")) {
      const row = this.db.admImportJobs.get(String(this.values[18]));
      if (!row) return changed(0);
      row.status = this.values[0];
      row.current_line = Number(this.values[1] ?? row.current_line);
      row.chunks_processed = Number(this.values[2] ?? row.chunks_processed);
      row.parsed_kills = Number(row.parsed_kills ?? 0) + Number(this.values[3] ?? 0);
      row.written_kills = Number(row.written_kills ?? 0) + Number(this.values[4] ?? 0);
      row.duplicate_skips = Number(row.duplicate_skips ?? 0) + Number(this.values[5] ?? 0);
      row.joins = Number(row.joins ?? 0) + Number(this.values[6] ?? 0);
      row.disconnects = Number(row.disconnects ?? 0) + Number(this.values[7] ?? 0);
      row.playerlist_snapshots = Number(row.playerlist_snapshots ?? 0) + Number(this.values[8] ?? 0);
      row.deaths = Number(row.deaths ?? 0) + Number(this.values[9] ?? 0);
      row.suicides = Number(row.suicides ?? 0) + Number(this.values[10] ?? 0);
      row.uncredited_deaths = Number(row.uncredited_deaths ?? 0) + Number(this.values[11] ?? 0);
      row.hit_lines = Number(row.hit_lines ?? 0) + Number(this.values[12] ?? 0);
      row.raw_events = Number(row.raw_events ?? 0) + Number(this.values[13] ?? 0);
      row.player_events = Number(row.player_events ?? 0) + Number(this.values[14] ?? 0);
      row.failed_writes = Number(row.failed_writes ?? 0) + Number(this.values[15] ?? 0);
      row.warnings_json = this.values[16];
      row.updated_at = this.values[17];
      return changed(1);
    }
    if (q.includes("update adm_import_jobs set") && q.includes("status = 'completed'")) {
      const row = this.db.admImportJobs.get(String(this.values[6]));
      if (!row) return changed(0);
      row.status = "completed";
      row.current_line = row.total_lines;
      row.chunks_processed = row.total_chunks;
      row.public_cache_updated = this.values[0];
      row.discord_jobs_queued = this.values[1];
      row.warnings_json = this.values[2];
      row.result_json = this.values[3];
      row.completed_at = this.values[4];
      row.updated_at = this.values[5];
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
      const row = this.db.admImportJobs.get(String(this.values[0]));
      return (row && row.server_id === this.values[1] ? row : null) as T | null;
    }
    if (q.includes("from adm_sync_state") && q.includes("select *")) return (this.db.admSyncState.get(String(this.values[0])) ?? null) as T | null;
    if (q.includes("select last_import_report_json from adm_sync_state")) return ({ last_import_report_json: this.db.admSyncState.get(String(this.values[0]))?.last_import_report_json ?? null } as T);
    if (q.includes("from linked_servers") && q.includes("server_subscriptions.plan_key")) return (this.db.linkedServers.get(String(this.values[0])) ?? null) as T | null;
    if (q.includes("from linked_servers") && q.includes("where linked_servers.id = ?") && q.includes("linked_servers.user_id = ?")) {
      const row = this.db.linkedServers.get(String(this.values[0]));
      return (row && row.user_id === this.values[1] ? row : null) as T | null;
    }
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
    if (q.includes("sum(case when event_type")) return ({ structures_built: 0, build_items_placed: 0, storage_items_placed: 0, traps_placed: 0, build_score: 0, last_build_at: null } as T);
    if (q.includes("select player_name, count(*) as count") && q.includes("from build_events")) return null;
    if (q.includes("from adm_sync_file_state")) return ({ count: 0 } as T);
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const q = normalizeSql(this.query);
    if (q.startsWith("pragma table_info")) return { results: [] };
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
            sort_time: event.occurred_at ?? event.created_at ?? "",
          })),
        ...this.db.playerEvents
          .filter((event) => event.linked_server_id === linkedServer)
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
            sort_time: event.occurred_at ?? event.created_at ?? "",
          })),
      ]
        .sort((a, b) => String(b.sort_time).localeCompare(String(a.sort_time)))
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
