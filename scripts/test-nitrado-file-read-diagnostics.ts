import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildAdmBackfillPlan } from "../functions/_lib/adm-sync";
import { fetchWithTimeout } from "../functions/_lib/nitrado";
import {
  classifyFetchError,
  errorCodeForHttpStatus,
  recordNitradoFileReadAttempt,
  sanitizeHeaders,
  sanitizeNitradoUrl,
  sanitizeResponseExcerpt,
} from "../functions/_lib/nitrado-diagnostics";

type RecordedBind = unknown[];

class FakePreparedStatement {
  constructor(private readonly binds: RecordedBind[]) {}

  bind(...values: unknown[]) {
    this.binds.push(values);
    return this;
  }

  async run() {
    return { success: true };
  }
}

class FakeDb {
  public binds: RecordedBind[] = [];

  prepare() {
    return new FakePreparedStatement(this.binds);
  }
}

async function main() {
  assert.equal(sanitizeHeaders({ Authorization: "Bearer secret-token", "content-type": "application/json" }), JSON.stringify({ "content-type": "application/json" }));

  const redactedUrl = sanitizeNitradoUrl("https://files.nitrado.net/download?token=super-secret-token-value&signature=abc123&file=dayzps/config/test.ADM&offset=0&count=4096");
  assert.ok(redactedUrl?.includes("token=REDACTED"));
  assert.ok(redactedUrl?.includes("signature=REDACTED"));
  assert.ok(redactedUrl?.includes("file=dayzps%2Fconfig%2Ftest.ADM"));
  const pathRedactedUrl = sanitizeNitradoUrl(`https://files.nitrado.net/${"a".repeat(100)}/download?short=maybe-sensitive&file=test.ADM`);
  assert.ok(pathRedactedUrl?.includes("/REDACTED/download"));
  assert.ok(pathRedactedUrl?.includes("short=REDACTED"));

  assert.equal(errorCodeForHttpStatus(503), "NITRADO_UPSTREAM_DOWN");
  assert.equal(errorCodeForHttpStatus(429), "NITRADO_RATE_LIMITED");
  assert.equal(errorCodeForHttpStatus(401), "NITRADO_UNAUTHORIZED");
  assert.equal(errorCodeForHttpStatus(403), "NITRADO_FORBIDDEN");
  assert.equal(errorCodeForHttpStatus(404), "NITRADO_FILE_NOT_FOUND");

  const timeout = classifyFetchError(new DOMException("The operation timed out", "AbortError"));
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.errorCode, "FETCH_TIMEOUT");

  const fetchThrew = classifyFetchError(new Error("connect ECONNRESET token=should-not-leak"));
  assert.equal(fetchThrew.status, "fetch_threw");
  assert.equal(fetchThrew.errorCode, "FETCH_THREW");
  assert.ok(!fetchThrew.errorMessage.includes("should-not-leak"));

  const workerLimit = classifyFetchError(new Error("Too many subrequests by single Worker invocation"));
  assert.equal(workerLimit.status, "fetch_threw");
  assert.equal(workerLimit.errorCode, "WORKER_SUBREQUEST_LIMIT");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  try {
    await assert.rejects(() => fetchWithTimeout("https://api.nitrado.net/test", {}, 1), /aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const excerpt = sanitizeResponseExcerpt(`error access_token=${"x".repeat(100)} body`);
  assert.ok(!excerpt?.includes("x".repeat(80)));

  const fakeDb = new FakeDb();
  await recordNitradoFileReadAttempt(fakeDb as unknown as D1Database, {
    serviceId: "17428528",
    serverId: "server-1",
    fileName: "DayZServer.ADM",
    filePath: "dayzps/config/DayZServer.ADM",
    method: "download",
    endpointKind: "nitrado_download",
    status: "non_ok_response",
    httpStatus: 503,
    errorCode: errorCodeForHttpStatus(503),
    requestUrlRedacted: "https://api.nitrado.net/services/17428528/gameservers/file_server/download?file=dayzps/config/DayZServer.ADM&token=secret",
  });
  const readAttemptBinds = () => fakeDb.binds.filter((bind) => bind.length >= 17);
  const recorded = readAttemptBinds()[0];
  assert.equal(recorded[8], "non_ok_response");
  assert.equal(recorded[9], 503);
  assert.equal(recorded[11], "NITRADO_UPSTREAM_DOWN");
  assert.ok(!String(recorded[16]).includes("secret"));

  await recordNitradoFileReadAttempt(fakeDb as unknown as D1Database, {
    serviceId: "17428528",
    fileName: "DayZServer.ADM",
    method: "download",
    endpointKind: "nitrado_download",
    status: "redirect_response",
    httpStatus: 302,
    errorCode: "NITRADO_DOWNLOAD_REDIRECT",
    responseExcerpt: "Location: https://files.nitrado.net/path?token=super-secret-token&signature=signed",
    requestUrlRedacted: "https://api.nitrado.net/services/17428528/gameservers/file_server/download?file=DayZServer.ADM",
  });
  const redirectRecorded = readAttemptBinds()[1];
  assert.equal(redirectRecorded[8], "redirect_response");
  assert.equal(redirectRecorded[9], 302);
  assert.equal(redirectRecorded[11], "NITRADO_DOWNLOAD_REDIRECT");
  assert.ok(!String(redirectRecorded[13]).includes("super-secret-token"));

  await recordNitradoFileReadAttempt(fakeDb as unknown as D1Database, {
    serviceId: "18765761",
    fileName: "admin_logs",
    filePath: "admin_logs/current",
    method: "admin_logs",
    endpointKind: "nitrado_admin_logs",
    status: "success",
    httpStatus: 200,
    responseExcerpt: "AdminLog started on 2026-05-26 at 07:02:39",
    requestUrlRedacted: "https://api.nitrado.net/services/18765761/gameservers/admin_logs",
  });
  const adminLogsRecorded = readAttemptBinds()[2];
  assert.equal(adminLogsRecorded[6], "nitrado_admin_logs");
  assert.equal(adminLogsRecorded[7], 1);
  assert.equal(adminLogsRecorded[8], "success");
  assert.equal(adminLogsRecorded[9], 200);

  const plan = buildAdmBackfillPlan({
    files: [
      { name: "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM", readable: false, readError: "Nitrado download returned HTTP 503" },
      { name: "DayZServer_PS4_x64_2026-05-20_09-01-27.ADM", readable: true },
    ],
    handledFilenames: [],
    existingJobs: [],
    planKey: "partner",
    nowMs: Date.UTC(2026, 4, 21),
    windowHours: 168,
    maxJobsToCreate: 3,
  });
  assert.deepEqual(plan.unreadableFiles.map((file) => file.filename), ["DayZServer_PS4_x64_2026-05-20_06-02-03.ADM"]);
  assert.ok(plan.createFiles.includes("DayZServer_PS4_x64_2026-05-20_09-01-27.ADM"));

  const migration = readFileSync("migrations/0033_nitrado_file_read_diagnostics.sql", "utf8").toLowerCase();
  assert.ok(!migration.includes("drop table"));
  assert.ok(!migration.includes("truncate"));
  assert.ok(!migration.includes("delete from player_profiles"));
  const backoffMigration = readFileSync("migrations/0035_adm_file_retry_backoff.sql", "utf8").toLowerCase();
  assert.ok(backoffMigration.includes("next_retry_at"));
  assert.ok(!backoffMigration.includes("drop table"));
  assert.ok(!backoffMigration.includes("truncate"));
  assert.ok(!backoffMigration.includes("delete from player_profiles"));
  const sourceMatrixMigration = readFileSync("migrations/0038_adm_live_source_rate_limits.sql", "utf8").toLowerCase();
  assert.ok(sourceMatrixMigration.includes("nitrado_rate_limits"));
  assert.ok(sourceMatrixMigration.includes("adm_live_source_state"));
  assert.ok(sourceMatrixMigration.includes("rate_limited_until"));
  assert.ok(!sourceMatrixMigration.includes("drop table"));
  assert.ok(!sourceMatrixMigration.includes("truncate"));
  assert.ok(!sourceMatrixMigration.includes("delete from player_profiles"));

  const nitradoSource = readFileSync("functions/_lib/nitrado.ts", "utf8");
  const diagnosticsSource = readFileSync("functions/_lib/nitrado-diagnostics.ts", "utf8");
  const admSyncSource = readFileSync("functions/_lib/adm-sync.ts", "utf8");
  const verifyAdmLiveSource = readFileSync("scripts/verify-production-adm-live.ts", "utf8");
  const workerSource = readFileSync("workers/adm-sync-worker.ts", "utf8");
  const workflowSource = readFileSync(".github/workflows/dzn-nitrado-diagnostics.yml", "utf8");
  assert.ok(nitradoSource.includes("TOKENIZED_EMPTY_BODY"));
  assert.ok(nitradoSource.includes("readNitradoAdminLogs"));
  assert.ok(nitradoSource.includes("/gameservers/admin_logs"));
  assert.ok(nitradoSource.includes("getNitradoReadSourceBackoff"));
  assert.ok(nitradoSource.includes("maxReadAttemptsPerFile"));
  assert.ok(nitradoSource.includes("broadLogFallback !== false"));
  assert.ok(nitradoSource.includes("recordNitradoFileReadAttempt"));
  assert.ok(nitradoSource.includes('redirect: "manual"'));
  assert.ok(nitradoSource.includes("redirect_response"));
  assert.ok(nitradoSource.includes("seek_probe"));
  assert.ok(nitradoSource.includes("readNitradoFileViaSeekChunked"));
  assert.ok(nitradoSource.includes("summarizeAdmFileReadOutcomes"));
  assert.ok(diagnosticsSource.includes("NITRADO_UPSTREAM_DOWN"));
  assert.ok(diagnosticsSource.includes("NITRADO_RATE_LIMITED"));
  assert.ok(diagnosticsSource.includes("nitrado_rate_limits"));
  assert.ok(diagnosticsSource.includes("adm_live_source_state"));
  assert.ok(diagnosticsSource.includes("getNitradoReadSourceBackoff"));
  assert.ok(diagnosticsSource.includes("getActiveNitradoRateLimit"));
  assert.ok(diagnosticsSource.includes("rateLimitBackoffMinutes"));
  assert.ok(diagnosticsSource.includes("gameserver_details_log_files_noftp_download"));
  assert.ok(diagnosticsSource.includes("preserveNoftpSuccess"));
  assert.ok(diagnosticsSource.includes("recoverable_retry_scheduled"));
  assert.ok(diagnosticsSource.includes("isRecoverableNoftpSourceFailure"));
  assert.ok(diagnosticsSource.includes("recordNoftpDiscoveryLiveSourceState"));
  assert.ok(diagnosticsSource.includes("discovery_success"));
  assert.ok(admSyncSource.includes("repairNoftpLiveSourceEvidence"));
  assert.ok(admSyncSource.includes("scheduled_nitrado_job_cursor"));
  assert.ok(admSyncSource.includes("scheduled_nitrado_import_completed"));
  assert.ok(admSyncSource.includes("adm_file_state_${values.status}"));
  assert.ok(verifyAdmLiveSource.includes("noftpSourceEvidenceFromFiles"));
  assert.ok(verifyAdmLiveSource.includes("noftpDiscoveryRecoverableEvidence"));
  assert.ok(verifyAdmLiveSource.includes("getHealthNoftpEvidence"));
  assert.ok(verifyAdmLiveSource.includes("Nitrado Log Files/noftp source is backed by current ADM health evidence"));
  assert.ok(verifyAdmLiveSource.includes("latestFileStateSource"));
  assert.ok(verifyAdmLiveSource.includes("expectedSourceKeys"));
  assert.ok(diagnosticsSource.includes("nitrado_admin_logs"));
  assert.ok(diagnosticsSource.includes("WORKER_SUBREQUEST_LIMIT"));
  assert.ok(admSyncSource.includes("ADM_MAX_FILES_PER_INVOCATION"));
  assert.ok(admSyncSource.includes("ADM_MAX_UNREADABLE_RETRIES_PER_INVOCATION"));
  assert.ok(admSyncSource.includes("ADM_MAX_READ_ATTEMPTS_PER_FILE"));
  assert.ok(admSyncSource.includes("ADM_MAX_TOKENIZED_ATTEMPTS_PER_FILE"));
  assert.ok(admSyncSource.includes("ADM_MAX_CHUNKED_READ_CHUNKS"));
  assert.ok(admSyncSource.includes("ADM_MAX_IMPORT_LINES_PER_INVOCATION"));
  assert.ok(admSyncSource.includes("ADM_MAX_D1_WRITE_BATCHES_PER_INVOCATION"));
  assert.ok(admSyncSource.includes("ADM_MAX_DIAGNOSTIC_ROWS_PER_INVOCATION"));
  assert.ok(admSyncSource.includes("getActiveNitradoRateLimit"));
  assert.ok(admSyncSource.includes("directPreferredFirst: scheduledBudgeted ? false : true"));
  assert.ok(admSyncSource.includes("scheduledBudgeted ? false : true"));
  assert.ok(admSyncSource.includes("maxReadAttemptsPerFile: scheduledBudgeted"));
  assert.ok(admSyncSource.includes("onlyLatest: scheduledBudgeted"));
  assert.ok(admSyncSource.includes("recordAdmPullResult(env, {"));
  assert.ok(admSyncSource.includes("per-invocation safety budget"));
  assert.ok(admSyncSource.includes("next_retry_at"));
  assert.ok(admSyncSource.includes("getAdmUnreadableBackoffMs"));
  assert.ok(admSyncSource.includes("isAdmUnreadableBackoffActive"));
  assert.ok(admSyncSource.includes("latest_adm_next_retry_at"));
  assert.ok(admSyncSource.includes("Latest ADM ${selected.latest_adm_file} is unreadable; retry is scheduled"));
  assert.ok(admSyncSource.includes("completed_or_active"));
  assert.ok(admSyncSource.includes("completed_or_active.filename = adm_sync_file_state.adm_file"));
  assert.ok(admSyncSource.includes("completed_or_active.status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable', 'completed', 'completed_with_warnings')"));
  assert.ok(admSyncSource.includes("FROM adm_sync_file_state target_due"));
  assert.ok(admSyncSource.includes("target_due_job.filename = target_due.adm_file"));
  assert.ok(admSyncSource.includes("adm_sync_state.last_processed_file IS NULL"));
  assert.ok(admSyncSource.includes("ORDER BY adm_sync_file_state.adm_file ASC"));
  assert.ok(
    admSyncSource.includes("adm_sync_file_state.status IN ('queued', 'unreadable', 'processed', 'partial', 'failed_unreadable'"),
    "Discovery must not downgrade unreadable file-state rows back to discovered without job/cursor evidence.",
  );
  assert.ok(
    admSyncSource.includes("status IN ('unreadable', 'discovered')"),
    "Exhausted discovered rows with unreadable retry evidence must be closed as failed_unreadable.",
  );
  assert.ok(admSyncSource.includes("const selectionReason = selected.target_adm_file"), "Worker selection reason should record target ADM work ahead of stale metadata.");
  const metadataPriorityIndex = admSyncSource.indexOf("CASE WHEN COALESCE(metadata_stale, 0) = 1 THEN 0 ELSE 1 END");
  const activeJobPriorityIndex = admSyncSource.indexOf("CASE WHEN COALESCE(active_import_jobs, 0) > 0 THEN 0 ELSE 1 END");
  const targetFilePriorityIndex = admSyncSource.indexOf("CASE WHEN target_adm_file IS NOT NULL THEN 0 ELSE 1 END");
  assert.ok(
    activeJobPriorityIndex >= 0
      && targetFilePriorityIndex >= 0
      && metadataPriorityIndex >= 0
      && targetFilePriorityIndex < activeJobPriorityIndex
      && activeJobPriorityIndex < metadataPriorityIndex,
    "Discovered target ADM files must outrank active jobs and stale metadata so noftp imports leave job/cursor evidence.",
  );
  assert.ok(admSyncSource.includes("COALESCE(current_line, 0) >= COALESCE(total_lines, 0)"));
  assert.ok(admSyncSource.includes("promoteNewestDiscoveredAdmFileInSyncState"), "Completed older ADM chunk jobs must not move latest_adm_file behind the newest discovered ADM.");
  assert.ok(admSyncSource.includes("ORDER BY file_timestamp DESC, adm_file DESC"), "Newest discovered ADM promotion should use timestamp ordering.");
  assert.ok(admSyncSource.includes("ADM file ${directFileName} is already imported; Worker advanced to the next server."));
  assert.ok(admSyncSource.includes("await updateAdmWorkerCursor(env, options.cursorKey ?? \"last_adm_linked_server_id\", selected.id).catch(() => null);"));
  assert.ok(admSyncSource.includes("stateLatestAdmFile"));
  assert.ok(admSyncSource.includes("compareAdmFileNamesChronological(selected.latest_adm_file, directFileName) >= 0"));
  assert.ok(admSyncSource.includes("targetFileName?: string | null"));
  assert.ok(admSyncSource.includes("targetFilePath?: string | null"));
  assert.ok(admSyncSource.includes("sanitizeWorkerTargetAdmPath"));
  assert.ok(admSyncSource.includes("selected_adm_path"));
  assert.ok(admSyncSource.includes("FROM adm_sync_file_state latest_state"));
  assert.ok(workerSource.includes("runAdmWorkerSyncTick"));
  assert.ok(!workerSource.includes("runScheduledAdmSync"));
  assert.ok(!workerSource.includes("selectNextAdmLinkedServerForWorker"));
  assert.ok(workerSource.includes("adm_worker_state"));
  assert.ok(workerSource.includes("ADM_WORKER_LAST_RECOVERY_KEY"));
  assert.ok(!workerSource.includes('path: "/api/sync/adm/run"'));
  assert.ok(workflowSource.includes("workflow_dispatch"));
  assert.ok(workflowSource.includes("/api/debug/nitrado-file-read"));
  assert.ok(workflowSource.includes("/api/sync/adm/retry-unreadable"));
  assert.ok(!workflowSource.includes("echo \"$DZN_CRON_SECRET\""));

  console.log("Nitrado file-read diagnostics tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
