import { parseAdmLine, parseAdmLines, type ParsedAdmEvent } from "./adm-parser";
import {
  classifyParsedBuildEvent,
  ensureBuildEventSchema,
  isParsedBuildEvent,
  rebuildServerBuildStats,
} from "./build-events";
import { getCurrentLinkedServer, requireDb, saveServerAdmPath } from "./db";
import { isMockNitrado } from "./mock";
import {
  detectNitradoAdmLogs,
  fetchReadableNitradoAdmFiles,
  fetchReadableNitradoAdmLines,
  getAdmLogStoragePath,
  mockAdmLogDetection,
  mockNitradoLogAccessDiagnostics,
  type NitradoDiscoveredAdmFile,
  type NitradoReadableAdmFile,
  type NitradoLogAccessDiagnostics,
  testExactNitradoAdmPath,
} from "./nitrado";
import { decryptToken } from "./crypto";
import {
  ensureAutomationSchema,
  getDueAdmDiscoveryAutomationServers,
  getDueAdmAutomationServers,
  markAdmPullStarted,
  queueDiscordPostUpdatesForGuild,
  recordAdmCadenceObservation,
  recordAdmDiscoveryResult,
  recordAdmPullResult,
  upsertServerPublicCache,
} from "./automation";
import {
  refreshLivePlayerCountsForActiveServers,
  refreshNitradoServerMetadata,
  type ScheduledMetadataSyncResult,
} from "./server-metadata";
import type { PlanKey } from "./plans";
import type { Env } from "./types";

export type SyncLinkedServer = {
  id: string;
  user_id: string;
  nitrado_service_id: string | null;
  adm_path: string | null;
  server_name?: string | null;
  display_name?: string | null;
  hostname?: string | null;
  nitrado_service_name?: string | null;
};

export type AdmSyncContext = {
  linkedServerId: string;
  nitradoServiceId: string;
  serverName: string;
  admFileName: string | null;
  syncRunId?: string;
};

type AdmSyncState = {
  latest_adm_file: string | null;
  latest_adm_path: string | null;
  last_processed_file: string | null;
  last_processed_line: number | null;
  last_processed_offset: number | null;
  last_processed_adm_line_hash: string | null;
  last_processed_adm_line_text_preview: string | null;
  last_cursor_validation_status: string | null;
  last_cursor_validation_error: string | null;
  last_cursor_validation_at: string | null;
  cursor_recovery_strategy: string | null;
  cursor_recovery_reason: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  last_sync_at: string | null;
  last_lines_read: number | null;
  last_lines_processed: number | null;
  last_raw_events_stored: number | null;
  last_player_events_stored: number | null;
  last_kill_events_stored: number | null;
  last_events_created: number | null;
  last_kills_created: number | null;
  last_unknown_lines: number | null;
  last_duplicate_lines: number | null;
  last_sync_duration_ms: number | null;
  last_readable_route: string | null;
  last_raw_kill_lines_found: number | null;
  last_parsed_kill_lines_found: number | null;
  last_parser_skipped_lines: number | null;
  last_unreadable_files_queued: number | null;
  last_newest_unprocessed_adm_file: string | null;
};

export type AdmSyncResult = {
  status: string;
  message: string;
  linesSeen: number;
  linesProcessed: number;
  eventsCreated: number;
  killsCreated: number;
  killsFound: number;
  newKillsCreated: number;
  duplicateKillsSkipped: number;
  playersUpdated: number;
  latestAdmFile: string | null;
  latestAdmTimestamp?: string | null;
  newestAvailableAdmFile?: string | null;
  newestAvailableAdmTimestamp?: string | null;
  newestReadableAdmFile?: string | null;
  newestReadableAdmTimestamp?: string | null;
  firstUsefulAdmLineAt?: string | null;
  lastUsefulAdmEventAt?: string | null;
  lastPlayerlistAt?: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
  readableRouteUsed: string | null;
  linesRead: number;
  syncStatus: string;
  rawEventsStored: number;
  playerEventsStored: number;
  killEventsStored: number;
  buildEventsStored: number;
  unknownLines: number;
  skippedDuplicateLines: number;
  syncDurationMs: number;
};

export type AdmSyncOptions = {
  triggerType?: "manual" | "scheduled";
  maxLinesPerRun?: number;
};

export type AdmImportDebugReport = {
  admFileName: string | null;
  cursorStart: number;
  cursorEnd: number;
  rawKilledByLinesFound: number;
  parsedPvpKills: number;
  skippedDeadHitLines: number;
  parsedSuicides: number;
  parsedUncreditedDeaths: number;
  duplicateSkips: number;
  pvpKillLineNumbers: number[];
};

type AdmCursorValidationStatus =
  | "valid"
  | "legacy_no_hash"
  | "hash_mismatch"
  | "line_out_of_range"
  | "hash_found_repositioned"
  | "safe_tail_reprocess"
  | "new_file";

type AdmCursorValidationReport = {
  cursorValidationStatus: AdmCursorValidationStatus;
  cursorValidationError: string | null;
  cursorRecoveryStrategy: string | null;
  cursorRecoveryReason: string | null;
  previousLineHash: string | null;
  currentLineHash: string | null;
  cursorLineChecked: number | null;
  cursorHashMatched: boolean | null;
};

export type AdmDatabaseImportReport = AdmImportDebugReport & {
  attemptedDbWrites: number;
  successfulDbWrites: number;
  writtenKills: number;
  failedWrites: number;
  cursorBefore: number;
  cursorAfter: number;
  cursorAdvanced: boolean;
  publicCacheUpdated: boolean;
  discordQueuesCreated: number;
  cacheRefreshStatus: "updated" | "skipped" | "failed";
  discordQueueStatus: "queued" | "skipped" | "failed";
} & AdmCursorValidationReport;

export type AdmFixtureImportResult = {
  status: AdmSyncStatusCode;
  message: string;
  report: AdmDatabaseImportReport;
  cursorBefore: number;
  cursorAfter: number;
  totalKills: number;
  totalDeaths: number;
  longestKillDistance: number;
};

export type AdmSyncStatusCode =
  | "completed"
  | "no_new_lines"
  | "no_supported_events"
  | "checking"
  | "waiting_after_restart"
  | "new_adm_detected"
  | "new_adm_readable"
  | "new_data_found"
  | "no_new_log_available"
  | "latest_adm_unreadable"
  | "delayed_after_restart"
  | "adm_not_generated_yet"
  | "adm_file_unreadable"
  | "nitrado_down"
  | "nitrado_auth_invalid"
  | "nitrado_rate_limited"
  | "dzn_parser_error"
  | "dzn_write_error"
  | "dzn_scope_blocked"
  | "no_adm_file"
  | "nitrado_error"
  | "parser_error"
  | "write_error"
  | "read_pending"
  | "not_started"
  | "active"
  | "idle"
  | "error"
  | "failed";

export type AdmSyncRunSummary = {
  id: string;
  trigger_type: "manual" | "scheduled" | string;
  status: string;
  message: string | null;
  lines_read: number;
  lines_processed: number;
  events_created: number;
  kills_created: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string | null;
};

export type AdmSyncStatus = {
  last_sync_status: string;
  last_sync_message: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_processed_line: number;
  last_sync_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  last_lines_read: number;
  last_lines_processed: number;
  last_raw_events_stored: number;
  last_player_events_stored: number;
  last_kill_events_stored: number;
  last_events_created: number;
  last_kills_created: number;
  last_unknown_lines: number;
  last_duplicate_lines: number;
  last_sync_duration_ms: number | null;
  last_readable_route: string | null;
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  last_successful_adm_discovery_at: string | null;
  last_failed_adm_discovery_at: string | null;
  last_adm_discovery_error: string | null;
  adm_discovery_status: string | null;
  next_adm_pull_due_at: string | null;
  newest_available_adm_filename: string | null;
  newest_available_adm_timestamp: string | null;
  newest_readable_adm_filename: string | null;
  newest_readable_adm_timestamp: string | null;
  first_adm_after_restart_at: string | null;
  first_adm_after_restart_delay_minutes: number | null;
  first_useful_adm_line_after_restart_at: string | null;
  observed_playerlist_interval_minutes: number | null;
  observed_adm_cadence_minutes: number | null;
  newest_adm_file_age_minutes: number | null;
  last_useful_adm_event_at: string | null;
  last_playerlist_at: string | null;
  next_expected_adm_update_at: string | null;
  nitrado_reduce_log_output_confirmed: boolean;
  nitrado_log_playerlist_confirmed: boolean;
  nitrado_log_settings_confirmed_at: string | null;
  nitrado_log_settings_verification_source: string | null;
  nitrado_admin_log_enabled: boolean | null;
  nitrado_server_log_enabled: boolean | null;
  nitrado_log_settings_last_checked_at: string | null;
  nitrado_log_settings_last_error: string | null;
  last_sync_trigger: string | null;
  last_scheduled_sync_at: string | null;
  last_manual_sync_at: string | null;
  last_successful_sync_at: string | null;
  adm_health_label: string;
  latest_adm_processed: string | null;
  newest_unprocessed_adm_file: string | null;
  unreadable_files_queued: number;
  raw_kill_lines_found: number;
  parsed_kill_lines_found: number;
  parser_skipped_lines: number;
  last_adm_import_report: AdmDatabaseImportReport | null;
  current_recovery_action: string;
  recent_sync_runs: AdmSyncRunSummary[];
};

export type AdmRecentSyncEvent = {
  source: "kill" | "player" | "build";
  event_type: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
  event_label: string;
  detail: string | null;
  cause: string | null;
  object_type: string | null;
  is_mock: boolean;
};

export type ReadableAdmLinesResult = {
  lines: string[];
  newestAdmFileName: string | null;
  latestAdmPath: string | null;
  readableRouteUsed: string | null;
  diagnostics: NitradoLogAccessDiagnostics | null;
  message: string;
};

type ReadableAdmFileForSync = {
  name: string;
  path: string | null;
  lines: string[];
  readableRouteUsed: string | null;
};

type DiscoveredAdmFileForSync = {
  name: string;
  path: string | null;
  timestamp: number | null;
};

function verifyAdmServerScope(linkedServer: SyncLinkedServer, syncRunId: string): AdmSyncContext {
  if (!linkedServer.id) throw new Error("ADM sync cannot run without a linked server id");
  if (!linkedServer.nitrado_service_id) throw new Error("No Nitrado service selected");
  console.log("DZN ADM SERVER SCOPE VERIFIED", {
    linkedServerId: linkedServer.id,
    serviceId: linkedServer.nitrado_service_id,
  });
  return {
    linkedServerId: linkedServer.id,
    nitradoServiceId: linkedServer.nitrado_service_id,
    serverName: firstString(linkedServer.display_name, linkedServer.hostname, linkedServer.server_name, linkedServer.nitrado_service_name) ?? linkedServer.id,
    admFileName: null,
    syncRunId,
  };
}

function withAdmFile(context: AdmSyncContext, admFileName: string | null): AdmSyncContext {
  return {
    ...context,
    admFileName,
  };
}

export function assertAdmWriteScope(
  context: AdmSyncContext,
  row: {
    linkedServerId?: string | null;
    sourceServiceId?: string | null;
    sourceAdmFile?: string | null;
  },
  target: string,
) {
  if (!row.linkedServerId) {
    console.log("DZN ADM WRITE BLOCKED MISSING SERVER SCOPE", { target, context });
    throw new Error(`ADM sync refused to write ${target} without linked_server_id`);
  }
  if (row.linkedServerId !== context.linkedServerId) {
    console.log("DZN ADM SERVER SCOPE VIOLATION BLOCKED", { target, expected: context.linkedServerId, actual: row.linkedServerId });
    throw new Error(`ADM sync refused to write ${target} for the wrong linked_server_id`);
  }
  if (row.sourceServiceId && row.sourceServiceId !== context.nitradoServiceId) {
    console.log("DZN ADM SERVER SCOPE VIOLATION BLOCKED", { target, expected: context.nitradoServiceId, actual: row.sourceServiceId });
    throw new Error(`ADM sync refused to write ${target} for the wrong Nitrado service id`);
  }
  if (context.admFileName && row.sourceAdmFile && row.sourceAdmFile !== context.admFileName) {
    console.log("DZN ADM SERVER SCOPE VIOLATION BLOCKED", { target, expected: context.admFileName, actual: row.sourceAdmFile });
    throw new Error(`ADM sync refused to write ${target} for the wrong ADM file`);
  }
}

export async function runAdmSync(
  env: Env,
  userId: string,
  linkedServerId?: string | null,
  options: AdmSyncOptions = {},
): Promise<AdmSyncResult> {
  const syncStartedAt = Date.now();
  const syncStartedAtIso = new Date(syncStartedAt).toISOString();
  const syncRunId = crypto.randomUUID();
  const triggerType = options.triggerType ?? "manual";
  const maxLinesPerRun = clampPositiveInteger(options.maxLinesPerRun ?? 50000, 50000);
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");
  const initialScope = verifyAdmServerScope(linkedServer, syncRunId);
  const nitradoServiceId = initialScope.nitradoServiceId;
  await refreshNitradoServerMetadata(env, {
    linkedServerId: initialScope.linkedServerId,
    userId: linkedServer.user_id,
    force: triggerType === "manual" || triggerType === "scheduled",
    softFail: true,
  }).catch(() => null);

  const existingState = await getSyncState(env, initialScope.linkedServerId);
  const isMock = isMockNitrado(env.MOCK_NITRADO);
  const now = new Date().toISOString();
  let admLog = isMock ? mockAdmLogDetection() : null;
  let readable: ReadableAdmLinesResult;
  let readableFiles: ReadableAdmFileForSync[] = [];
  let discoveredAdmFiles: DiscoveredAdmFileForSync[] = [];
  let discoveredNewestAdmFile: string | null = null;
  let discoveredFilesFound = 0;
  let discoveryApiStatus: string | null = null;
  try {
    const preferredAdmPath = existingState?.latest_adm_path ?? linkedServer.adm_path ?? null;
    const preferredAdmFileName = existingState?.latest_adm_file ?? fileNameFromPath(preferredAdmPath);
    const batch = await getReadableAdmFilesForLinkedServer(env, linkedServer, {
      isMock,
      readMode: "full",
      preferredAdmPath,
      previousLatestAdmFileName: preferredAdmFileName,
      maxFiles: 12,
    });
    readableFiles = batch.files;
    discoveredAdmFiles = batch.candidates;
    discoveredNewestAdmFile = batch.newestAdmFileName;
    discoveredFilesFound = batch.filesFound;
    discoveryApiStatus = batch.apiStatus;
    const newestReadableFile = readableFiles.at(-1) ?? null;
    readable = {
      lines: newestReadableFile?.lines ?? [],
      newestAdmFileName: discoveredNewestAdmFile ?? newestReadableFile?.name ?? null,
      latestAdmPath: newestReadableFile?.path ?? preferredAdmPath,
      readableRouteUsed: newestReadableFile?.readableRouteUsed ?? null,
      diagnostics: null,
      message: batch.message,
    };
    if (!readableFiles.length && !isMock) {
      const token = await getNitradoTokenForLinkedServer(env, linkedServer);
      admLog = linkedServer.adm_path
        ? await testExactNitradoAdmPath(token, nitradoServiceId, linkedServer.adm_path)
        : await detectNitradoAdmLogs(token, nitradoServiceId);
    }
  } catch (error) {
    const syncDurationMs = Date.now() - syncStartedAt;
    const latestAdmPath = existingState?.latest_adm_path ?? linkedServer.adm_path ?? null;
    const latestAdmFile = existingState?.latest_adm_file ?? fileNameFromPath(latestAdmPath);
    const status = classifyNitradoExceptionStatus(error, latestAdmFile);
    const message = status === "adm_file_unreadable"
      ? "Latest ADM file found, but Nitrado did not return readable log content during this sync. DZN will retry automatically."
      : getUnavailableAdmMessage(status);
    await upsertSyncState(env, initialScope.linkedServerId, {
      latestAdmFile,
      latestAdmPath,
      sourceServiceId: initialScope.nitradoServiceId,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status,
      message,
      lastSyncAt: now,
      linesRead: 0,
      linesProcessed: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      unknownLines: 0,
      duplicateLines: 0,
      syncDurationMs,
      readableRoute: null,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      parserSkippedLines: 0,
      unreadableFilesQueued: await countQueuedUnreadableAdmFiles(env, initialScope.linkedServerId),
      newestUnprocessedAdmFile: latestAdmFile,
    });
    await recordSyncRun(env, {
      id: syncRunId,
      linkedServerId: initialScope.linkedServerId,
      sourceServiceId: initialScope.nitradoServiceId,
      triggerType,
      status,
      message,
      linesRead: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      startedAt: syncStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: syncDurationMs,
    });
    console.log("DZN ADM SYNC STATUS CLARIFIED", { status, latestAdmFile });
    console.log("DZN ADM FEED SYNC STATUS IMPROVED", { status, latestAdmFile, preservedLastProcessedLine: Number(existingState?.last_processed_line ?? 0) });
    if (["nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "adm_not_generated_yet", "adm_file_unreadable"].includes(status)) {
      console.log("DZN ADM ONLY BLOCKED BY NITRADO STATUS", { status, latestAdmFile });
    }
    return emptyAdmSyncResult({
      status,
      message,
      latestAdmFile,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastSyncAt: now,
      syncDurationMs,
    });
  }

  const latestAdmPath = readable.latestAdmPath ?? (admLog ? getAdmLogStoragePath(admLog) : null) ?? existingState?.latest_adm_path ?? linkedServer.adm_path ?? null;
  const latestAdmFile = discoveredNewestAdmFile ?? readable.newestAdmFileName ?? admLog?.newestAdmFileName ?? existingState?.latest_adm_file ?? fileNameFromPath(latestAdmPath);
  if (!discoveredAdmFiles.length && readableFiles.length) {
    discoveredAdmFiles = readableFiles.map((file) => ({
      name: file.name,
      path: file.path,
      timestamp: extractAdmTimestampScore(file.name),
    }));
  }
  const newestAvailableAdm = selectNewestDiscoveredAdmFile(discoveredAdmFiles) ?? (latestAdmFile ? {
    name: latestAdmFile,
    path: latestAdmPath,
    timestamp: extractAdmTimestampScore(latestAdmFile),
  } : null);
  const newestReadableAdm = selectNewestReadableAdmFile(readableFiles);
  const newestAvailableAdmTimestamp = timestampIso(newestAvailableAdm?.timestamp ?? null);
  const newestReadableAdmTimestamp = timestampIso(newestReadableAdm ? extractAdmTimestampScore(newestReadableAdm.name) : null);
  const latestAdmTimestamp = newestAvailableAdmTimestamp ?? timestampIso(extractAdmTimestampScore(latestAdmFile));
  console.log("DZN ADM FILE DISCOVERY", {
    server: initialScope.serverName,
    serviceId: initialScope.nitradoServiceId,
    filesFound: discoveredFilesFound,
    newestAdmFile: latestAdmFile,
    newestAvailableAdmFile: newestAvailableAdm?.name ?? null,
    newestReadableAdmFile: newestReadableAdm?.name ?? null,
    previousLatestAdmFile: existingState?.latest_adm_file ?? null,
  });
  await recordDiscoveredAdmFiles(env, initialScope, discoveredAdmFiles);
  if ((admLog?.admFileExists || readable.lines.length) && latestAdmPath) {
    await saveServerAdmPath(env, initialScope.linkedServerId, latestAdmPath.replace(/^\/+/, ""));
  }
  const scope = withAdmFile(initialScope, latestAdmFile);

  const lines = readable.lines.length ? readable.lines : getReadableAdmLines(admLog?.debug?.samplePreview ?? null);
  if (!readableFiles.length && lines.length) {
    readableFiles = [{
      name: latestAdmFile ?? "unknown-adm",
      path: latestAdmPath,
      lines,
      readableRouteUsed: readable.readableRouteUsed,
    }];
  }
  const readableByName = new Map(readableFiles.map((file) => [file.name, file]));
  const candidateQueue = selectAdmCandidatesForCursor(discoveredAdmFiles, existingState?.last_processed_file ?? null);
  const unreadableBeforeProcessing = candidateQueue.find((candidate) => !readableByName.has(candidate.name)) ?? null;
  if (unreadableBeforeProcessing) {
    await recordAdmFileAttempt(env, initialScope, unreadableBeforeProcessing, {
      status: "unreadable",
      lineCount: 0,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      insertedKills: 0,
      parserSkippedLines: 0,
      message: "ADM filename exists, but Nitrado did not return readable content this check.",
    });
  }
  if (!lines.length) {
    const admAvailable = Boolean(admLog?.admFileExists || readable.newestAdmFileName || discoveredFilesFound > 0);
    const status = classifyUnavailableAdmFileStatus(latestAdmFile, admAvailable, discoveryApiStatus);
    const message = getUnavailableAdmMessage(status);
    await upsertSyncState(env, scope.linkedServerId, {
      latestAdmFile,
      latestAdmPath,
      sourceServiceId: scope.nitradoServiceId,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status,
      message,
      lastSyncAt: now,
      linesRead: 0,
      linesProcessed: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      unknownLines: 0,
      duplicateLines: 0,
      syncDurationMs: Date.now() - syncStartedAt,
      readableRoute: readable.readableRouteUsed,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      parserSkippedLines: 0,
      unreadableFilesQueued: unreadableBeforeProcessing ? 1 : 0,
      newestUnprocessedAdmFile: unreadableBeforeProcessing?.name ?? latestAdmFile,
    });
    const syncDurationMs = Date.now() - syncStartedAt;
    await recordSyncRun(env, {
      id: syncRunId,
      linkedServerId: scope.linkedServerId,
      sourceServiceId: scope.nitradoServiceId,
      triggerType,
      status,
      message,
      linesRead: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      startedAt: syncStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: syncDurationMs,
    });
    console.log("DZN ADM SYNC STATUS CLARIFIED", { status, latestAdmFile });
    console.log("DZN ADM FEED SYNC STATUS IMPROVED", { status, latestAdmFile, preservedLastProcessedLine: Number(existingState?.last_processed_line ?? 0) });
    if (["nitrado_down", "nitrado_auth_invalid", "nitrado_rate_limited", "adm_not_generated_yet", "adm_file_unreadable"].includes(status)) {
      console.log("DZN ADM ONLY BLOCKED BY NITRADO STATUS", { status, latestAdmFile });
    }
    return {
      status,
      message,
      linesSeen: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      killsFound: 0,
      newKillsCreated: 0,
      duplicateKillsSkipped: 0,
      playersUpdated: 0,
      latestAdmFile,
      latestAdmTimestamp,
      newestAvailableAdmFile: newestAvailableAdm?.name ?? latestAdmFile,
      newestAvailableAdmTimestamp,
      newestReadableAdmFile: newestReadableAdm?.name ?? null,
      newestReadableAdmTimestamp,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastSyncAt: now,
      readableRouteUsed: readable.readableRouteUsed,
      linesRead: 0,
      syncStatus: status,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      buildEventsStored: 0,
      unknownLines: 0,
      skippedDuplicateLines: 0,
      syncDurationMs,
    };
  }
  const processableFilesBeforeUnreadable = collectReadableAdmFilesUntilUnreadable(candidateQueue, readableByName);
  if (unreadableBeforeProcessing && !processableFilesBeforeUnreadable.length) {
    const status: AdmSyncStatusCode = "adm_file_unreadable";
    const message = "Latest ADM file found, but Nitrado has not returned readable content yet. DZN will retry automatically.";
    const syncDurationMs = Date.now() - syncStartedAt;
    await upsertSyncState(env, scope.linkedServerId, {
      latestAdmFile,
      latestAdmPath,
      sourceServiceId: scope.nitradoServiceId,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status,
      message,
      lastSyncAt: now,
      linesRead: 0,
      linesProcessed: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      unknownLines: 0,
      duplicateLines: 0,
      syncDurationMs,
      readableRoute: readable.readableRouteUsed,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      parserSkippedLines: 0,
      unreadableFilesQueued: await countQueuedUnreadableAdmFiles(env, scope.linkedServerId),
      newestUnprocessedAdmFile: unreadableBeforeProcessing.name,
    });
    await recordSyncRun(env, {
      id: syncRunId,
      linkedServerId: scope.linkedServerId,
      sourceServiceId: scope.nitradoServiceId,
      triggerType,
      status,
      message,
      linesRead: 0,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      startedAt: syncStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: syncDurationMs,
    });
    console.log("DZN ADM SELF HEALING ACTIVE", { linkedServerId: scope.linkedServerId, queuedFile: unreadableBeforeProcessing.name });
    console.log("DZN ADM ONLY BLOCKED BY NITRADO STATUS", { status, latestAdmFile });
    return emptyAdmSyncResult({
      status,
      message,
      latestAdmFile,
      latestAdmTimestamp,
      newestAvailableAdmFile: newestAvailableAdm?.name ?? latestAdmFile,
      newestAvailableAdmTimestamp,
      newestReadableAdmFile: newestReadableAdm?.name ?? null,
      newestReadableAdmTimestamp,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastSyncAt: now,
      readableRouteUsed: readable.readableRouteUsed,
      linesRead: 0,
      syncDurationMs,
    });
  }

  let eventsCreated = 0;
  let killsCreated = 0;
  let joinsCreated = 0;
  let disconnectsCreated = 0;
  let deathsCreated = 0;
  let rawEventsStored = 0;
  let playerEventsStored = 0;
  let killEventsStored = 0;
  let buildEventsStored = 0;
  let unknownLines = 0;
  let duplicateLines = 0;
  let processedOffset = 0;
  let lastEventAt: string | null = null;
  let totalLinesRead = 0;
  let totalLinesProcessed = 0;
  let pendingLineCount = 0;
  let rawKillLinesFound = 0;
  let creditedKillLinesFound = 0;
  let parsedKillLinesFound = 0;
  let parserSkippedLines = 0;
  let firstUsefulAdmLineAt: string | null = null;
  let lastUsefulAdmEventAt: string | null = null;
  let lastPlayerlistAt: string | null = null;
  let cursorFile = existingState?.last_processed_file ?? null;
  let cursorLine = Number(existingState?.last_processed_line ?? 0);
  let cursorOffset = Number(existingState?.last_processed_offset ?? 0);
  let readableRouteUsed = readable.readableRouteUsed;
  let lastProcessedLineForError = cursorLine;
  let cursorValidationReport: AdmCursorValidationReport = defaultCursorValidationReport(cursorFile ? "legacy_no_hash" : "new_file");
  let lastProcessedAdmLineHash = existingState?.last_processed_adm_line_hash ?? null;
  let lastProcessedAdmLineTextPreview = existingState?.last_processed_adm_line_text_preview ?? null;
  const filesToProcess = processableFilesBeforeUnreadable.length
    ? processableFilesBeforeUnreadable
    : selectAdmFilesForCursor(readableFiles, existingState?.last_processed_file ?? null);

  try {
    for (const file of filesToProcess) {
      const fileScope = withAdmFile(initialScope, file.name);
      const fileLines = file.lines;
      const parsedLines = parseAdmLines(fileLines, { admDate: extractAdmDateFromFile(file.name) ?? undefined });
      const isSameAdmFile = Boolean(file.name && existingState?.last_processed_file === file.name);
      const cursorValidation = await validateAdmCursorForLines({
        lines: fileLines,
        sameFile: isSameAdmFile,
        savedLine: Number(existingState?.last_processed_line ?? 0),
        savedHash: existingState?.last_processed_adm_line_hash ?? null,
      });
      cursorValidationReport = {
        cursorValidationStatus: cursorValidation.cursorValidationStatus,
        cursorValidationError: cursorValidation.cursorValidationError,
        cursorRecoveryStrategy: cursorValidation.cursorRecoveryStrategy,
        cursorRecoveryReason: cursorValidation.cursorRecoveryReason,
        previousLineHash: cursorValidation.previousLineHash,
        currentLineHash: cursorValidation.currentLineHash,
        cursorLineChecked: cursorValidation.cursorLineChecked,
        cursorHashMatched: cursorValidation.cursorHashMatched,
      };
      const fileStartLine = cursorValidation.startLine;
      const remainingBudget = Math.max(0, maxLinesPerRun - totalLinesProcessed);
      const pendingParsedEvents = remainingBudget > 0
        ? parsedLines.slice(fileStartLine, fileStartLine + remainingBudget)
        : [];
      const recentDeathLines = new Map<string, number>();
      const warmupStart = Math.max(0, fileStartLine - 5);
      const rawKillLinesThisFile = fileLines.slice(fileStartLine).filter(hasRawPlayerKillLine).length;
      const parsedKillLinesThisFile = pendingParsedEvents.filter(isCreditedKillEvent).length;
      const parserSkippedThisFile = Math.max(0, rawKillLinesThisFile - parsedKillLinesThisFile);
      totalLinesRead += fileLines.length;
      pendingLineCount += pendingParsedEvents.length;
      rawKillLinesFound += rawKillLinesThisFile;
      creditedKillLinesFound += parsedLines.filter(isCreditedKillEvent).length;
      parsedKillLinesFound += parsedKillLinesThisFile;
      parserSkippedLines += parserSkippedThisFile;
      readableRouteUsed = file.readableRouteUsed ?? readableRouteUsed;
      processedOffset = isSameAdmFile && fileStartLine === Number(existingState?.last_processed_line ?? 0)
        ? Number(existingState?.last_processed_offset ?? 0)
        : calculateAdmLineOffset(fileLines, fileStartLine);
      const killsBeforeFile = killsCreated;

      if (rawKillLinesThisFile > 0 && parsedKillLinesThisFile <= 0) {
        await recordAdmFileAttempt(env, fileScope, {
          name: file.name,
          path: file.path,
          timestamp: extractAdmTimestampScore(file.name),
        }, {
          status: "parser_error",
          lineCount: fileLines.length,
          rawKillLinesFound: rawKillLinesThisFile,
          parsedKillLinesFound: 0,
          insertedKills: 0,
          parserSkippedLines: rawKillLinesThisFile,
          message: "Raw killed by Player lines were found but the parser did not match them.",
        });
        throw new AdmParserMismatchError(file.name, rawKillLinesThisFile);
      }

      for (let index = warmupStart; index < fileStartLine; index += 1) {
        const previousEvent = parsedLines[index];
        if (previousEvent && isDeathCountingEvent(previousEvent)) {
          markDeathCounted(recentDeathLines, previousEvent, index + 1);
        }
      }

      const backfillResult = await backfillMissingCreditedKills(
        env,
        fileScope,
        parsedLines,
        fileStartLine,
        recentDeathLines,
      );
      eventsCreated += backfillResult.eventsCreated;
      killEventsStored += backfillResult.killEventsCreated;
      killsCreated += backfillResult.killsCreated;
      deathsCreated += backfillResult.deathsCreated;
      duplicateLines += backfillResult.duplicatesSkipped;
      if (backfillResult.lastEventAt) lastEventAt = backfillResult.lastEventAt;

      for (let index = 0; index < pendingParsedEvents.length; index += 1) {
        const parsed = pendingParsedEvents[index];
        const rawLine = parsed.rawLine;
        const lineNumber = fileStartLine + index + 1;
        const cadenceTimestamp = parsed.occurredAt ?? now;
        if (isUsefulAdmCadenceEvent(parsed)) {
          firstUsefulAdmLineAt ??= cadenceTimestamp;
          lastUsefulAdmEventAt = cadenceTimestamp;
        }
        if (parsed.eventType === "playerlist_snapshot") {
          lastPlayerlistAt = cadenceTimestamp;
        }
        const rawInserted = await insertRawEvent(env, fileScope, lineNumber, rawLine, parsed);
        processedOffset += rawLine.length + 1;
        if (!rawInserted) duplicateLines += 1;
        else rawEventsStored += 1;
        if (parsed.eventType === "unknown") unknownLines += 1;

        const eventResult = await persistParsedEvent(env, fileScope, lineNumber, parsed, {
          recentDeathLines,
        });
        eventsCreated += eventResult.eventsCreated;
        playerEventsStored += eventResult.playerEventsCreated;
        killEventsStored += eventResult.killEventsCreated;
        buildEventsStored += eventResult.buildEventsCreated;
        killsCreated += eventResult.killsCreated;
        joinsCreated += eventResult.joinsCreated;
        disconnectsCreated += eventResult.disconnectsCreated;
        deathsCreated += eventResult.deathsCreated;
        lastEventAt = parsed.occurredAt ?? now;
      }

      totalLinesProcessed += pendingParsedEvents.length;
      cursorFile = file.name;
      cursorLine = fileStartLine + pendingParsedEvents.length;
      cursorOffset = processedOffset;
      lastProcessedLineForError = cursorLine;
      const cursorSnapshot = await buildProcessedCursorSnapshot(fileLines, cursorLine);
      lastProcessedAdmLineHash = cursorSnapshot.hash;
      lastProcessedAdmLineTextPreview = cursorSnapshot.preview;
      await recordAdmFileAttempt(env, fileScope, {
        name: file.name,
        path: file.path,
        timestamp: extractAdmTimestampScore(file.name),
      }, {
        status: cursorLine >= fileLines.length ? "processed" : "partial",
        lineCount: fileLines.length,
        rawKillLinesFound: rawKillLinesThisFile,
        parsedKillLinesFound: parsedKillLinesThisFile,
        insertedKills: killsCreated - killsBeforeFile,
        parserSkippedLines: parserSkippedThisFile,
        lastLineProcessed: cursorLine,
        message: cursorLine >= fileLines.length ? "ADM file processed successfully." : "ADM file partially processed due to per-run line budget.",
      });
      if (totalLinesProcessed >= maxLinesPerRun) break;
    }
  } catch (error) {
    const syncDurationMs = Date.now() - syncStartedAt;
    const parserMismatch = error instanceof AdmParserMismatchError;
    const scopeBlocked = /wrong linked_server_id|wrong Nitrado service id|wrong ADM file|without linked_server_id|scope/i.test(safeSyncErrorMessage(error));
    const status: AdmSyncStatusCode = parserMismatch ? "dzn_parser_error" : scopeBlocked ? "dzn_scope_blocked" : "dzn_write_error";
    const message = parserMismatch
      ? `DZN found ${error.rawKillLinesFound} raw kill lines in ${error.admFile}, but the parser matched zero. Parser update required.`
      : scopeBlocked
        ? `ADM write blocked by server scope guardrails. ${safeSyncErrorMessage(error)}`
        : `ADM write failed. ${safeSyncErrorMessage(error)}`;
    await upsertSyncState(env, initialScope.linkedServerId, {
      latestAdmFile,
      latestAdmPath,
      sourceServiceId: initialScope.nitradoServiceId,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: lastProcessedLineForError,
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status,
      message,
      lastSyncAt: now,
      linesRead: totalLinesRead,
      linesProcessed: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      unknownLines: 0,
      duplicateLines: 0,
      syncDurationMs,
      readableRoute: readableRouteUsed,
      rawKillLinesFound,
      parsedKillLinesFound,
      parserSkippedLines,
      unreadableFilesQueued: await countQueuedUnreadableAdmFiles(env, initialScope.linkedServerId),
      newestUnprocessedAdmFile: cursorFile,
      importReportJson: JSON.stringify({
        ...buildAdmImportDebugReport(lines, {
          admFileName: cursorFile ?? latestAdmFile,
          cursorStart: Number(existingState?.last_processed_line ?? 0),
          cursorEnd: Number(existingState?.last_processed_line ?? 0),
        }),
        attemptedDbWrites: rawEventsStored + playerEventsStored + killEventsStored + buildEventsStored + 1,
        successfulDbWrites: rawEventsStored + playerEventsStored + killEventsStored + buildEventsStored,
        writtenKills: killEventsStored,
        failedWrites: 1,
        cursorBefore: Number(existingState?.last_processed_line ?? 0),
        cursorAfter: Number(existingState?.last_processed_line ?? 0),
        cursorAdvanced: false,
        publicCacheUpdated: false,
        discordQueuesCreated: 0,
        cacheRefreshStatus: "skipped",
        discordQueueStatus: "skipped",
        ...cursorValidationReport,
      } satisfies AdmDatabaseImportReport),
      lastProcessedAdmLineHash: existingState?.last_processed_adm_line_hash ?? null,
      lastProcessedAdmLineTextPreview: existingState?.last_processed_adm_line_text_preview ?? null,
      lastCursorValidationStatus: cursorValidationReport.cursorValidationStatus,
      lastCursorValidationError: cursorValidationReport.cursorValidationError,
      lastCursorValidationAt: now,
      cursorRecoveryStrategy: cursorValidationReport.cursorRecoveryStrategy,
      cursorRecoveryReason: cursorValidationReport.cursorRecoveryReason,
    });
    await recordSyncRun(env, {
      id: syncRunId,
      linkedServerId: initialScope.linkedServerId,
      sourceServiceId: initialScope.nitradoServiceId,
      triggerType,
      status,
      message,
      linesRead: totalLinesRead,
      linesProcessed: 0,
      eventsCreated: 0,
      killsCreated: 0,
      startedAt: syncStartedAtIso,
      finishedAt: new Date().toISOString(),
      durationMs: syncDurationMs,
    });
    return emptyAdmSyncResult({
      status,
      message,
      latestAdmFile,
      lastProcessedLine: lastProcessedLineForError,
      lastSyncAt: now,
      readableRouteUsed,
      linesRead: totalLinesRead,
      syncDurationMs,
    });
  }

  const syncDurationMs = Date.now() - syncStartedAt;
  const uniquePlayers = await countUniquePlayers(env, initialScope.linkedServerId);
  const duplicateKillsSkipped = Math.max(0, parsedKillLinesFound - killsCreated);
  const status = classifyAdmSyncOutcome({
    pendingLineCount,
    eventsCreated,
    killsCreated,
    buildEventsStored,
    parsedKillLinesFound,
    duplicateKillsSkipped,
  });
  const message = buildSyncRunMessage({
    triggerType,
    status,
    linesRead: totalLinesRead,
    linesProcessed: totalLinesProcessed,
    creditedKillLinesFound,
    parsedKillLinesFound,
    killsCreated,
    buildEventsStored,
    duplicateKillsSkipped,
    uniquePlayers,
    eventsCreated,
  });
  await upsertServerStats(env, initialScope.linkedServerId, {
    sourceServiceId: initialScope.nitradoServiceId,
    kills: killsCreated,
    deaths: deathsCreated,
    joins: joinsCreated,
    disconnects: disconnectsCreated,
    uniquePlayers,
    lastEventAt,
  });
  await rebuildServerBuildStats(env, initialScope.linkedServerId);
  await recordAdmCadenceObservation(env, {
    linkedServerId: initialScope.linkedServerId,
    firstUsefulAdmLineAt,
    lastUsefulAdmEventAt,
    lastPlayerlistAt,
  });
  const importReport: AdmDatabaseImportReport = {
    ...buildAdmImportDebugReport(lines, {
      admFileName: cursorFile ?? latestAdmFile,
      cursorStart: Number(existingState?.last_processed_line ?? 0),
      cursorEnd: cursorLine,
    }),
    attemptedDbWrites: totalLinesProcessed + eventsCreated,
    successfulDbWrites: rawEventsStored + playerEventsStored + killEventsStored + buildEventsStored,
    writtenKills: killEventsStored,
    failedWrites: 0,
    cursorBefore: Number(existingState?.last_processed_line ?? 0),
    cursorAfter: cursorLine,
    cursorAdvanced: cursorLine > Number(existingState?.last_processed_line ?? 0),
    publicCacheUpdated: false,
    discordQueuesCreated: 0,
    cacheRefreshStatus: "skipped",
    discordQueueStatus: "skipped",
    ...cursorValidationReport,
  };
  if (buildEventsStored > 0) console.log("DZN ADM BUILD EVENTS SYNCED", { linkedServerId: initialScope.linkedServerId, buildEventsStored });
  await upsertSyncState(env, initialScope.linkedServerId, {
    latestAdmFile,
    latestAdmPath,
    sourceServiceId: initialScope.nitradoServiceId,
    lastProcessedFile: cursorFile ?? latestAdmFile,
    lastProcessedLine: cursorLine,
    lastProcessedOffset: cursorOffset,
    status,
    message,
    lastSyncAt: now,
    linesRead: totalLinesRead,
    linesProcessed: totalLinesProcessed,
    rawEventsStored,
    playerEventsStored,
    killEventsStored,
    eventsCreated,
    killsCreated,
    unknownLines,
    duplicateLines,
    syncDurationMs,
    readableRoute: readableRouteUsed,
    rawKillLinesFound,
    parsedKillLinesFound,
    parserSkippedLines,
    unreadableFilesQueued: await countQueuedUnreadableAdmFiles(env, initialScope.linkedServerId),
    newestUnprocessedAdmFile: unreadableBeforeProcessing?.name ?? null,
    importReportJson: JSON.stringify(importReport),
    lastProcessedAdmLineHash,
    lastProcessedAdmLineTextPreview,
    lastCursorValidationStatus: cursorValidationReport.cursorValidationStatus,
    lastCursorValidationError: cursorValidationReport.cursorValidationError,
    lastCursorValidationAt: now,
    cursorRecoveryStrategy: cursorValidationReport.cursorRecoveryStrategy,
    cursorRecoveryReason: cursorValidationReport.cursorRecoveryReason,
  });
  await recordSyncRun(env, {
    id: syncRunId,
    linkedServerId: initialScope.linkedServerId,
    sourceServiceId: initialScope.nitradoServiceId,
    triggerType,
    status,
    message,
    linesRead: totalLinesRead,
    linesProcessed: totalLinesProcessed,
    eventsCreated,
    killsCreated,
    startedAt: syncStartedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs: syncDurationMs,
  });
  await rebuildServerStats(env, initialScope.linkedServerId);
  console.log("DZN ADM SYNC STATUS CLARIFIED", { status, latestAdmFile });
  console.log("DZN ADM FEED SYNC STATUS IMPROVED", { status, latestAdmFile, linesRead: totalLinesRead, eventsCreated, killsCreated });
  console.log("DZN ADM FULL SYNC COMPLETE");
  console.log("DZN ADM MISSION CRITICAL SYNC READY", { linkedServerId: initialScope.linkedServerId, status, filesProcessed: filesToProcess.length });
  if (unreadableBeforeProcessing) console.log("DZN ADM SELF HEALING ACTIVE", { linkedServerId: initialScope.linkedServerId, queuedFile: unreadableBeforeProcessing.name });

  return {
    status,
    message,
    linesSeen: totalLinesRead,
    linesProcessed: totalLinesProcessed,
    eventsCreated,
    killsCreated,
    killsFound: creditedKillLinesFound,
    newKillsCreated: killsCreated,
    duplicateKillsSkipped,
    playersUpdated: uniquePlayers,
    latestAdmFile,
    latestAdmTimestamp,
    newestAvailableAdmFile: newestAvailableAdm?.name ?? latestAdmFile,
    newestAvailableAdmTimestamp,
    newestReadableAdmFile: newestReadableAdm?.name ?? null,
    newestReadableAdmTimestamp,
    firstUsefulAdmLineAt,
    lastUsefulAdmEventAt,
    lastPlayerlistAt,
    lastProcessedLine: cursorLine,
    lastSyncAt: now,
    readableRouteUsed,
    linesRead: totalLinesRead,
    syncStatus: status,
    rawEventsStored,
    playerEventsStored,
    killEventsStored,
    buildEventsStored,
    unknownLines,
    skippedDuplicateLines: duplicateLines,
    syncDurationMs,
  };
}

export function classifyAdmSyncOutcome(values: {
  pendingLineCount: number;
  eventsCreated: number;
  killsCreated: number;
  buildEventsStored: number;
  parsedKillLinesFound?: number;
  duplicateKillsSkipped?: number;
}): AdmSyncStatusCode {
  if (values.pendingLineCount <= 0) return "no_new_lines";
  if ((values.parsedKillLinesFound ?? 0) > 0 && values.killsCreated <= 0 && (values.duplicateKillsSkipped ?? 0) >= (values.parsedKillLinesFound ?? 0)) {
    return "completed";
  }
  if (values.eventsCreated <= 0 && values.killsCreated <= 0 && values.buildEventsStored <= 0) return "no_supported_events";
  return "completed";
}

function isUsefulAdmCadenceEvent(parsed: ParsedAdmEvent) {
  return ![
    "admin_log_started",
    "playerlist_delimiter",
    "unknown",
  ].includes(parsed.eventType);
}

export function isAdmSyncErrorStatus(status: string | null | undefined) {
  return [
    "nitrado_down",
    "nitrado_auth_invalid",
    "nitrado_rate_limited",
    "dzn_parser_error",
    "dzn_write_error",
    "dzn_scope_blocked",
    "nitrado_error",
    "parser_error",
    "write_error",
    "error",
    "failed",
  ].includes(String(status ?? "").toLowerCase());
}

export function isAdmSyncTemporarilyUnavailableStatus(status: string | null | undefined) {
  return [
    "adm_file_unreadable",
    "nitrado_file_unavailable",
    "latest_adm_unreadable",
    "waiting_after_restart",
    "delayed_after_restart",
  ].includes(String(status ?? "").toLowerCase());
}

function buildSyncRunMessage(values: {
  triggerType: "manual" | "scheduled" | string;
  status: AdmSyncStatusCode;
  linesRead: number;
  linesProcessed: number;
  creditedKillLinesFound: number;
  parsedKillLinesFound: number;
  killsCreated: number;
  buildEventsStored: number;
  duplicateKillsSkipped: number;
  uniquePlayers: number;
  eventsCreated: number;
}) {
  const prefix = values.triggerType === "manual" ? "Manual sync" : "Scheduled sync";
  if (values.status === "no_new_lines") {
    return `${prefix} checked latest ADM. No new ADM lines since last sync. Lines scanned: ${values.linesRead}. Kill lines found this check: ${values.creditedKillLinesFound}.`;
  }
  if (values.status === "no_supported_events") {
    return `${prefix} checked latest ADM. No supported ADM events found. Lines scanned: ${values.linesRead}. New lines scanned: ${values.linesProcessed}. Kill lines found this check: ${values.creditedKillLinesFound}. Kill lines parsed this check: ${values.parsedKillLinesFound}. Kill events inserted this check: ${values.killsCreated}. Kill lines skipped this check: ${values.duplicateKillsSkipped}.`;
  }
  return `${prefix} completed successfully. Lines scanned: ${values.linesRead}. New lines scanned: ${values.linesProcessed}. Activity events created: ${values.eventsCreated}. Kill lines found this check: ${values.creditedKillLinesFound}. Kill lines parsed this check: ${values.parsedKillLinesFound}. Kill events inserted this check: ${values.killsCreated}. Build events created: ${values.buildEventsStored}. Kill lines skipped this check: ${values.duplicateKillsSkipped}. Players updated: ${values.uniquePlayers}.`;
}

export function classifyUnavailableAdmFileStatus(
  latestAdmFile: string | null | undefined,
  admAvailable: boolean,
  apiStatus?: string | null,
  lastServerRestartAt?: string | null,
  nowMs = Date.now(),
): "adm_file_unreadable" | "adm_not_generated_yet" | "delayed_after_restart" | "nitrado_down" | "nitrado_auth_invalid" | "nitrado_rate_limited" {
  if (apiStatus === "401" || apiStatus === "403") return "nitrado_auth_invalid";
  if (apiStatus === "429") return "nitrado_rate_limited";
  if (apiStatus === "error" && !latestAdmFile && !admAvailable) return "nitrado_down";
  if (!latestAdmFile && !admAvailable && isAdmDelayedAfterRestart(lastServerRestartAt, nowMs)) return "delayed_after_restart";
  return latestAdmFile || admAvailable ? "adm_file_unreadable" : "adm_not_generated_yet";
}

function getUnavailableAdmMessage(status: AdmSyncStatusCode) {
  if (status === "nitrado_auth_invalid") return "Nitrado token or service permission is invalid, expired, or forbidden.";
  if (status === "nitrado_rate_limited") return "Nitrado rate limited ADM access. DZN will retry automatically.";
  if (status === "nitrado_down") return "Nitrado is currently unavailable. DZN will retry automatically.";
  if (status === "adm_file_unreadable" || status === "latest_adm_unreadable") return "Latest ADM file found but not readable yet. DZN will retry on the next scheduled check.";
  if (status === "delayed_after_restart") return "Nitrado has not published a readable ADM log yet. This can take 5-45 minutes after restart.";
  return "Server restart detected. Waiting for Nitrado to publish the next ADM log.";
}

function getAdmHealthLabel(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (["completed", "no_new_lines", "no_supported_events", "new_data_found", "no_new_log_available", "active", "idle"].includes(normalized)) return "Healthy";
  if (["adm_not_generated_yet", "no_adm_file", "waiting_after_restart"].includes(normalized)) return "Waiting for ADM";
  if (["adm_file_unreadable", "latest_adm_unreadable", "nitrado_file_unavailable"].includes(normalized)) return "ADM temporarily unreadable";
  if (normalized === "delayed_after_restart") return "Delayed after restart";
  if (normalized === "nitrado_down" || normalized === "nitrado_rate_limited" || normalized === "nitrado_error") return "Nitrado unavailable";
  if (normalized === "nitrado_auth_invalid") return "Token/service issue";
  if (normalized === "dzn_parser_error" || normalized === "parser_error") return "Parser attention needed";
  if (normalized === "dzn_write_error" || normalized === "dzn_scope_blocked" || normalized === "write_error") return "Broken";
  return "Delayed";
}

function getAdmRecoveryAction(status: string | null | undefined, unreadableQueued: number) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "nitrado_auth_invalid") return "Reconnect or refresh the server owner's Nitrado token/service permission.";
  if (normalized === "nitrado_down") return "Nitrado is unavailable. DZN will retry automatically.";
  if (normalized === "nitrado_rate_limited") return "Nitrado throttled requests. DZN will retry on the next scheduled run.";
  if (normalized === "adm_not_generated_yet" || normalized === "no_adm_file" || normalized === "waiting_after_restart") return "Waiting for Nitrado to publish a readable ADM log. This is normal after restart.";
  if (normalized === "delayed_after_restart") return "Nitrado has not published a readable ADM log yet. DZN will keep checking on the plan schedule.";
  if (normalized === "adm_file_unreadable" || normalized === "latest_adm_unreadable") return "ADM file is queued for retry. DZN will self-heal when Nitrado returns readable content.";
  if (normalized === "dzn_parser_error" || normalized === "parser_error") return "Parser update required; raw kill lines are preserved for diagnosis.";
  if (normalized === "dzn_write_error" || normalized === "write_error") return "Database write failed; cursor was not advanced and DZN will retry.";
  if (normalized === "dzn_scope_blocked") return "Server scope guardrail blocked a write; review linked_server_id/service mapping.";
  if (unreadableQueued > 0) return "Queued ADM files will be retried automatically.";
  return "ADM sync healthy. Latest file processed successfully.";
}

export function compareAdmFileNamesChronological(a: string | null | undefined, b: string | null | undefined) {
  const aScore = extractAdmTimestampScore(a);
  const bScore = extractAdmTimestampScore(b);
  if (aScore !== null && bScore !== null && aScore !== bScore) return aScore - bScore;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function normalizeAdmSyncStateMachineStatus(status: string | null | undefined): string {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "completed") return "new_data_found";
  if (normalized === "no_new_lines") return "no_new_log_available";
  if (normalized === "adm_file_unreadable") return "latest_adm_unreadable";
  if (normalized === "adm_not_generated_yet" || normalized === "no_adm_file") return "waiting_after_restart";
  if ([
    "idle",
    "checking",
    "waiting_after_restart",
    "new_adm_detected",
    "new_adm_readable",
    "new_data_found",
    "no_new_log_available",
    "latest_adm_unreadable",
    "delayed_after_restart",
    "failed",
  ].includes(normalized)) return normalized;
  return normalized || "idle";
}

export function isAdmDelayedAfterRestart(lastServerRestartAt: string | null | undefined, nowMs = Date.now()) {
  if (!lastServerRestartAt) return false;
  const restartedAt = Date.parse(lastServerRestartAt);
  return Number.isFinite(restartedAt) && nowMs - restartedAt >= 45 * 60 * 1000;
}

export function detectAdmRestartFromFiles(previousLatestAdmFile: string | null | undefined, newestAdmFile: string | null | undefined) {
  const previousScore = extractAdmTimestampScore(previousLatestAdmFile);
  const newestScore = extractAdmTimestampScore(newestAdmFile);
  if (previousScore === null || newestScore === null) return false;
  return newestScore > previousScore;
}

function selectAdmFilesForCursor(files: ReadableAdmFileForSync[], lastProcessedFile: string | null | undefined) {
  const ordered = [...files].sort((a, b) => compareAdmFileNamesChronological(a.name, b.name));
  if (!lastProcessedFile) return ordered;
  return ordered.filter((file) => compareAdmFileNamesChronological(file.name, lastProcessedFile) >= 0);
}

function selectAdmCandidatesForCursor(files: DiscoveredAdmFileForSync[], lastProcessedFile: string | null | undefined) {
  const ordered = [...files].sort(compareAdmCandidatesChronological);
  if (!lastProcessedFile) return ordered;
  return ordered.filter((file) => compareAdmFileNamesChronological(file.name, lastProcessedFile) >= 0);
}

function selectNewestDiscoveredAdmFile(files: DiscoveredAdmFileForSync[]) {
  return [...files].sort((a, b) => compareAdmCandidatesChronological(b, a))[0] ?? null;
}

function selectNewestReadableAdmFile(files: ReadableAdmFileForSync[]) {
  return [...files].sort((a, b) => compareAdmFileNamesChronological(b.name, a.name))[0] ?? null;
}

function timestampIso(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function compareAdmCandidatesChronological(a: DiscoveredAdmFileForSync, b: DiscoveredAdmFileForSync) {
  if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return compareAdmFileNamesChronological(a.name, b.name);
}

function collectReadableAdmFilesUntilUnreadable(candidates: DiscoveredAdmFileForSync[], readableByName: Map<string, ReadableAdmFileForSync>) {
  const files: ReadableAdmFileForSync[] = [];
  for (const candidate of candidates) {
    const readable = readableByName.get(candidate.name);
    if (!readable) break;
    files.push(readable);
  }
  return files;
}

function hasRawPlayerKillLine(line: string) {
  return /\bkilled by\s+Player\s+"/i.test(line);
}

const ADM_CURSOR_RECOVERY_TAIL_LINES = 500;

type AdmCursorValidationResult = AdmCursorValidationReport & {
  startLine: number;
};

async function sha1Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeAdmLinePreview(value: string | null | undefined) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function defaultCursorValidationReport(status: AdmCursorValidationStatus = "new_file"): AdmCursorValidationReport {
  return {
    cursorValidationStatus: status,
    cursorValidationError: null,
    cursorRecoveryStrategy: null,
    cursorRecoveryReason: null,
    previousLineHash: null,
    currentLineHash: null,
    cursorLineChecked: null,
    cursorHashMatched: null,
  };
}

async function validateAdmCursorForLines(values: {
  lines: string[];
  sameFile: boolean;
  savedLine: number;
  savedHash: string | null | undefined;
  tailWindow?: number;
}): Promise<AdmCursorValidationResult> {
  const lineCount = values.lines.length;
  const savedLine = Math.max(0, Math.trunc(Number(values.savedLine) || 0));
  const savedHash = typeof values.savedHash === "string" && values.savedHash.trim() ? values.savedHash.trim() : null;
  const tailWindow = Math.max(1, Math.trunc(values.tailWindow ?? ADM_CURSOR_RECOVERY_TAIL_LINES));
  const safeTailStart = Math.max(0, lineCount - tailWindow);

  if (!values.sameFile) {
    return { ...defaultCursorValidationReport("new_file"), startLine: 0 };
  }

  if (savedLine <= 0) {
    return {
      ...defaultCursorValidationReport(savedHash ? "valid" : "legacy_no_hash"),
      cursorLineChecked: 0,
      cursorHashMatched: savedHash ? true : null,
      startLine: 0,
    };
  }

  if (savedLine > lineCount) {
    return {
      cursorValidationStatus: "line_out_of_range",
      cursorValidationError: `Saved cursor line ${savedLine} is beyond current ADM length ${lineCount}.`,
      cursorRecoveryStrategy: "safe_tail_reprocess",
      cursorRecoveryReason: "file_truncated_or_rollover",
      previousLineHash: savedHash,
      currentLineHash: null,
      cursorLineChecked: savedLine,
      cursorHashMatched: false,
      startLine: safeTailStart,
    };
  }

  if (!savedHash) {
    return {
      ...defaultCursorValidationReport("legacy_no_hash"),
      cursorLineChecked: savedLine,
      cursorHashMatched: null,
      startLine: savedLine,
    };
  }

  const currentLine = values.lines[savedLine - 1] ?? "";
  const currentHash = await sha1Text(currentLine);
  if (currentHash === savedHash) {
    return {
      cursorValidationStatus: "valid",
      cursorValidationError: null,
      cursorRecoveryStrategy: null,
      cursorRecoveryReason: null,
      previousLineHash: savedHash,
      currentLineHash: currentHash,
      cursorLineChecked: savedLine,
      cursorHashMatched: true,
      startLine: savedLine,
    };
  }

  for (let index = 0; index < values.lines.length; index += 1) {
    if (await sha1Text(values.lines[index]) === savedHash) {
      return {
        cursorValidationStatus: "hash_found_repositioned",
        cursorValidationError: `Saved cursor hash did not match line ${savedLine}, but was found at line ${index + 1}.`,
        cursorRecoveryStrategy: "hash_found_repositioned",
        cursorRecoveryReason: "saved_line_moved",
        previousLineHash: savedHash,
        currentLineHash: currentHash,
        cursorLineChecked: savedLine,
        cursorHashMatched: false,
        startLine: index + 1,
      };
    }
  }

  return {
    cursorValidationStatus: "safe_tail_reprocess",
    cursorValidationError: `Saved cursor hash did not match line ${savedLine} and was not found in the current ADM file.`,
    cursorRecoveryStrategy: "safe_tail_reprocess",
    cursorRecoveryReason: "hash_mismatch",
    previousLineHash: savedHash,
    currentLineHash: currentHash,
    cursorLineChecked: savedLine,
    cursorHashMatched: false,
    startLine: safeTailStart,
  };
}

async function buildProcessedCursorSnapshot(lines: string[], cursorLine: number) {
  const safeCursorLine = clampCursorLine(cursorLine, lines.length);
  if (safeCursorLine <= 0) {
    return { hash: null, preview: null };
  }
  const line = lines[safeCursorLine - 1] ?? "";
  return {
    hash: await sha1Text(line),
    preview: safeAdmLinePreview(line),
  };
}

export function buildAdmImportDebugReport(
  lines: string[],
  options: { admFileName?: string | null; cursorStart?: number; cursorEnd?: number } = {},
): AdmImportDebugReport {
  const admFileName = options.admFileName ?? null;
  const cursorStart = clampCursorLine(options.cursorStart ?? 0, lines.length);
  const cursorEnd = clampCursorLine(options.cursorEnd ?? lines.length, lines.length);
  const parsed = parseAdmLines(lines, { admDate: extractAdmDateFromFile(admFileName) ?? undefined });
  const pendingLines = lines.slice(cursorStart, cursorEnd);
  const pendingEvents = parsed.slice(cursorStart, cursorEnd);
  const pvpKillLineNumbers: number[] = [];
  const seenKillKeys = new Set<string>();
  let duplicateSkips = 0;

  for (let index = 0; index < pendingEvents.length; index += 1) {
    const event = pendingEvents[index];
    if (!event || !isCreditedKillEvent(event)) continue;
    pvpKillLineNumbers.push(cursorStart + index + 1);
    const key = importDebugKillKey(event);
    if (seenKillKeys.has(key)) duplicateSkips += 1;
    else seenKillKeys.add(key);
  }

  return {
    admFileName,
    cursorStart,
    cursorEnd,
    rawKilledByLinesFound: pendingLines.filter(hasRawPlayerKillLine).length,
    parsedPvpKills: pvpKillLineNumbers.length,
    skippedDeadHitLines: pendingEvents.filter(isDeadHitNonKillEvent).length,
    parsedSuicides: pendingEvents.filter((event) => event.eventType === "player_suicide").length,
    parsedUncreditedDeaths: pendingEvents.filter((event) => event.eventType === "player_died_stats").length,
    duplicateSkips,
    pvpKillLineNumbers,
  };
}

export async function importReadableAdmLinesIntoDatabase(
  env: Env,
  input: {
    context: AdmSyncContext;
    lines: string[];
    admPath?: string | null;
    triggerType?: "manual" | "scheduled" | string;
    maxLinesPerRun?: number;
    guildId?: string | null;
    planKey?: PlanKey;
    publicServerName?: string | null;
    updatePublicCache?: boolean;
    queueDiscordPosts?: boolean;
  },
): Promise<AdmFixtureImportResult> {
  await ensureAdmSyncSchema(env);
  const now = new Date().toISOString();
  const triggerType: "manual" | "scheduled" = input.triggerType === "scheduled" ? "scheduled" : "manual";
  const maxLinesPerRun = clampPositiveInteger(input.maxLinesPerRun ?? 50000, 50000);
  const existingState = await getSyncState(env, input.context.linkedServerId);
  const cursorBefore = Number(existingState?.last_processed_line ?? 0);
  const cursorValidation = await validateAdmCursorForLines({
    lines: input.lines,
    sameFile: existingState?.last_processed_file === input.context.admFileName,
    savedLine: cursorBefore,
    savedHash: existingState?.last_processed_adm_line_hash ?? null,
  });
  const cursorValidationReport: AdmCursorValidationReport = {
    cursorValidationStatus: cursorValidation.cursorValidationStatus,
    cursorValidationError: cursorValidation.cursorValidationError,
    cursorRecoveryStrategy: cursorValidation.cursorRecoveryStrategy,
    cursorRecoveryReason: cursorValidation.cursorRecoveryReason,
    previousLineHash: cursorValidation.previousLineHash,
    currentLineHash: cursorValidation.currentLineHash,
    cursorLineChecked: cursorValidation.cursorLineChecked,
    cursorHashMatched: cursorValidation.cursorHashMatched,
  };
  const fileStartLine = cursorValidation.startLine;
  const parsedLines = parseAdmLines(input.lines, { admDate: extractAdmDateFromFile(input.context.admFileName) ?? undefined });
  const pendingParsedEvents = parsedLines.slice(fileStartLine, fileStartLine + maxLinesPerRun);
  const baseReport = buildAdmImportDebugReport(input.lines, {
    admFileName: input.context.admFileName,
    cursorStart: fileStartLine,
    cursorEnd: fileStartLine + pendingParsedEvents.length,
  });
  const recentDeathLines = new Map<string, number>();
  const syncRunId = input.context.syncRunId ?? crypto.randomUUID();
  const context = { ...input.context, syncRunId };
  const startedAt = now;
  let attemptedDbWrites = 0;
  let successfulDbWrites = 0;
  let rawEventsStored = 0;
  let playerEventsStored = 0;
  let killEventsStored = 0;
  let buildEventsStored = 0;
  let eventsCreated = 0;
  let killsCreated = 0;
  let deathsCreated = 0;
  let joinsCreated = 0;
  let disconnectsCreated = 0;
  let unknownLines = 0;
  let duplicateLines = 0;
  let lastEventAt: string | null = null;
  let cursorAfter = cursorBefore;
  let publicCacheUpdated = false;
  let discordQueuesCreated = 0;
  let cacheRefreshStatus: AdmDatabaseImportReport["cacheRefreshStatus"] = "skipped";
  let discordQueueStatus: AdmDatabaseImportReport["discordQueueStatus"] = "skipped";

  const buildReport = (values: { failedWrites?: number; cursorLine?: number } = {}): AdmDatabaseImportReport => ({
    ...baseReport,
    attemptedDbWrites,
    successfulDbWrites,
    writtenKills: killEventsStored,
    failedWrites: values.failedWrites ?? 0,
    cursorBefore,
    cursorAfter: values.cursorLine ?? cursorAfter,
    cursorAdvanced: (values.cursorLine ?? cursorAfter) > cursorBefore,
    publicCacheUpdated,
    discordQueuesCreated,
    cacheRefreshStatus,
    discordQueueStatus,
    ...cursorValidationReport,
  });

  try {
    for (let index = 0; index < pendingParsedEvents.length; index += 1) {
      const parsed = pendingParsedEvents[index];
      const rawLine = parsed.rawLine;
      const lineNumber = fileStartLine + index + 1;
      attemptedDbWrites += 1;
      const rawInserted = await insertRawEvent(env, context, lineNumber, rawLine, parsed);
      if (rawInserted) {
        rawEventsStored += 1;
        successfulDbWrites += 1;
      } else {
        duplicateLines += 1;
      }
      if (parsed.eventType === "unknown") unknownLines += 1;

      if (![
        "admin_log_started",
        "playerlist_snapshot",
        "playerlist_delimiter",
        "unknown",
      ].includes(parsed.eventType)) {
        attemptedDbWrites += 1;
      }
      const eventResult = await persistParsedEvent(env, context, lineNumber, parsed, { recentDeathLines });
      const eventWrites = eventResult.playerEventsCreated + eventResult.killEventsCreated + eventResult.buildEventsCreated;
      successfulDbWrites += eventWrites;
      eventsCreated += eventResult.eventsCreated;
      playerEventsStored += eventResult.playerEventsCreated;
      killEventsStored += eventResult.killEventsCreated;
      buildEventsStored += eventResult.buildEventsCreated;
      killsCreated += eventResult.killsCreated;
      deathsCreated += eventResult.deathsCreated;
      joinsCreated += eventResult.joinsCreated;
      disconnectsCreated += eventResult.disconnectsCreated;
      if (eventWrites === 0 && parsed.eventType !== "admin_log_started" && parsed.eventType !== "playerlist_snapshot" && parsed.eventType !== "playerlist_delimiter" && parsed.eventType !== "unknown") {
        duplicateLines += 1;
      }
      if (eventResult.eventsCreated > 0) lastEventAt = parsed.occurredAt ?? now;
    }

    cursorAfter = fileStartLine + pendingParsedEvents.length;
    const uniquePlayers = await countUniquePlayers(env, context.linkedServerId);
    await upsertServerStats(env, context.linkedServerId, {
      sourceServiceId: context.nitradoServiceId,
      kills: killsCreated,
      deaths: deathsCreated,
      joins: joinsCreated,
      disconnects: disconnectsCreated,
      uniquePlayers,
      lastEventAt,
    });
    await rebuildServerStats(env, context.linkedServerId);

    if (input.updatePublicCache && input.guildId && input.planKey) {
      try {
        await upsertServerPublicCache(env, {
          guildId: input.guildId,
          planKey: input.planKey,
          publicServerName: input.publicServerName,
          lastAdmUpdateAt: now,
        });
        publicCacheUpdated = true;
        cacheRefreshStatus = "updated";
      } catch {
        cacheRefreshStatus = "failed";
      }
    }

    if (input.queueDiscordPosts && input.guildId && input.planKey && (eventsCreated > 0 || killsCreated > 0 || buildEventsStored > 0)) {
      try {
        discordQueuesCreated = await queueDiscordPostUpdatesForGuild(env, input.guildId, input.planKey, [
          "leaderboard_embed",
          "daily_summary_embed",
          "event_leaderboard_embed",
          "network_ranking_embed",
          "server_vs_server_embed",
          "killfeed_embed",
          "pve_feed_embed",
          "hit_feed_embed",
          "connection_feed_embed",
          "build_feed_embed",
          "admin_alerts_embed",
          "admin_logs_embed",
        ], "adm-data-change");
        discordQueueStatus = discordQueuesCreated > 0 ? "queued" : "skipped";
      } catch {
        discordQueueStatus = "failed";
      }
    }

    const report = buildReport({ cursorLine: cursorAfter });
    const cursorSnapshot = await buildProcessedCursorSnapshot(input.lines, cursorAfter);
    await upsertSyncState(env, context.linkedServerId, {
      latestAdmFile: context.admFileName,
      latestAdmPath: input.admPath ?? context.admFileName,
      sourceServiceId: context.nitradoServiceId,
      lastProcessedFile: context.admFileName,
      lastProcessedLine: cursorAfter,
      lastProcessedOffset: calculateAdmLineOffset(input.lines, cursorAfter),
      status: "completed",
      message: `Fixture ADM import completed. Kill events inserted this check: ${killsCreated}.`,
      lastSyncAt: now,
      linesRead: input.lines.length,
      linesProcessed: pendingParsedEvents.length,
      rawEventsStored,
      playerEventsStored,
      killEventsStored,
      eventsCreated,
      killsCreated,
      unknownLines,
      duplicateLines,
      syncDurationMs: 0,
      readableRoute: "fixture",
      rawKillLinesFound: baseReport.rawKilledByLinesFound,
      parsedKillLinesFound: baseReport.parsedPvpKills,
      parserSkippedLines: baseReport.skippedDeadHitLines,
      unreadableFilesQueued: 0,
      newestUnprocessedAdmFile: null,
      importReportJson: JSON.stringify(report),
      lastProcessedAdmLineHash: cursorSnapshot.hash,
      lastProcessedAdmLineTextPreview: cursorSnapshot.preview,
      lastCursorValidationStatus: cursorValidationReport.cursorValidationStatus,
      lastCursorValidationError: cursorValidationReport.cursorValidationError,
      lastCursorValidationAt: now,
      cursorRecoveryStrategy: cursorValidationReport.cursorRecoveryStrategy,
      cursorRecoveryReason: cursorValidationReport.cursorRecoveryReason,
    });
    await recordSyncRun(env, {
      id: syncRunId,
      linkedServerId: context.linkedServerId,
      sourceServiceId: context.nitradoServiceId,
      triggerType,
      status: "completed",
      message: "Fixture ADM import completed.",
      linesRead: input.lines.length,
      linesProcessed: pendingParsedEvents.length,
      eventsCreated,
      killsCreated,
      startedAt,
      finishedAt: now,
      durationMs: 0,
    });
    const totals = await getAdmImportTotals(env, context.linkedServerId);
    return {
      status: "completed",
      message: "Fixture ADM import completed.",
      report,
      cursorBefore,
      cursorAfter,
      totalKills: totals.totalKills,
      totalDeaths: totals.totalDeaths,
      longestKillDistance: totals.longestKillDistance,
    };
  } catch (error) {
    const report = buildReport({ failedWrites: 1, cursorLine: cursorBefore });
    await upsertSyncState(env, context.linkedServerId, {
      latestAdmFile: context.admFileName,
      latestAdmPath: input.admPath ?? context.admFileName,
      sourceServiceId: context.nitradoServiceId,
      lastProcessedFile: existingState?.last_processed_file ?? null,
      lastProcessedLine: cursorBefore,
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status: "dzn_write_error",
      message: `ADM write failed. ${safeSyncErrorMessage(error)}`,
      lastSyncAt: now,
      linesRead: input.lines.length,
      linesProcessed: 0,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      unknownLines: 0,
      duplicateLines: 0,
      syncDurationMs: 0,
      readableRoute: "fixture",
      rawKillLinesFound: baseReport.rawKilledByLinesFound,
      parsedKillLinesFound: baseReport.parsedPvpKills,
      parserSkippedLines: baseReport.skippedDeadHitLines,
      unreadableFilesQueued: 0,
      newestUnprocessedAdmFile: context.admFileName,
      importReportJson: JSON.stringify(report),
      lastProcessedAdmLineHash: existingState?.last_processed_adm_line_hash ?? null,
      lastProcessedAdmLineTextPreview: existingState?.last_processed_adm_line_text_preview ?? null,
      lastCursorValidationStatus: cursorValidationReport.cursorValidationStatus,
      lastCursorValidationError: cursorValidationReport.cursorValidationError,
      lastCursorValidationAt: now,
      cursorRecoveryStrategy: cursorValidationReport.cursorRecoveryStrategy,
      cursorRecoveryReason: cursorValidationReport.cursorRecoveryReason,
    });
    return {
      status: "dzn_write_error",
      message: `ADM write failed. ${safeSyncErrorMessage(error)}`,
      report,
      cursorBefore,
      cursorAfter: cursorBefore,
      totalKills: 0,
      totalDeaths: 0,
      longestKillDistance: 0,
    };
  }
}

function clampCursorLine(value: number, lineCount: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(Math.trunc(numeric), lineCount));
}

function calculateAdmLineOffset(lines: string[], cursorLine: number) {
  const safeCursorLine = clampCursorLine(cursorLine, lines.length);
  return lines.slice(0, safeCursorLine).reduce((total, line) => total + line.length + 1, 0);
}

function isDeadHitNonKillEvent(event: ParsedAdmEvent) {
  return (
    event.eventType === "player_hit" &&
    event.victimDead &&
    !event.isCreditedKill
  );
}

function importDebugKillKey(event: ParsedAdmEvent) {
  return [
    event.occurredAt ?? "",
    event.killerId ?? event.killerName ?? "",
    event.victimId ?? event.victimName ?? "",
    event.weapon ?? "",
    event.distance === null ? "" : event.distance.toFixed(4),
  ].join("|");
}

class AdmParserMismatchError extends Error {
  constructor(public admFile: string, public rawKillLinesFound: number) {
    super(`Raw killed by Player lines found in ${admFile}, but parser matched zero`);
  }
}

function emptyAdmSyncResult(values: {
  status: AdmSyncStatusCode;
  message: string;
  latestAdmFile: string | null;
  latestAdmTimestamp?: string | null;
  newestAvailableAdmFile?: string | null;
  newestAvailableAdmTimestamp?: string | null;
  newestReadableAdmFile?: string | null;
  newestReadableAdmTimestamp?: string | null;
  lastProcessedLine: number;
  lastSyncAt: string;
  readableRouteUsed?: string | null;
  linesRead?: number;
  syncDurationMs: number;
}): AdmSyncResult {
  return {
    status: values.status,
    message: values.message,
    linesSeen: values.linesRead ?? 0,
    linesProcessed: 0,
    eventsCreated: 0,
    killsCreated: 0,
    killsFound: 0,
    newKillsCreated: 0,
    duplicateKillsSkipped: 0,
    playersUpdated: 0,
    latestAdmFile: values.latestAdmFile,
    latestAdmTimestamp: values.latestAdmTimestamp ?? null,
    newestAvailableAdmFile: values.newestAvailableAdmFile ?? values.latestAdmFile,
    newestAvailableAdmTimestamp: values.newestAvailableAdmTimestamp ?? values.latestAdmTimestamp ?? null,
    newestReadableAdmFile: values.newestReadableAdmFile ?? null,
    newestReadableAdmTimestamp: values.newestReadableAdmTimestamp ?? null,
    lastProcessedLine: values.lastProcessedLine,
    lastSyncAt: values.lastSyncAt,
    readableRouteUsed: values.readableRouteUsed ?? null,
    linesRead: values.linesRead ?? 0,
    syncStatus: values.status,
    rawEventsStored: 0,
    playerEventsStored: 0,
    killEventsStored: 0,
    buildEventsStored: 0,
    unknownLines: 0,
    skippedDuplicateLines: 0,
    syncDurationMs: values.syncDurationMs,
  };
}

export async function getAdmSyncStatus(env: Env, userId: string, linkedServerId?: string | null): Promise<AdmSyncStatus> {
  await ensureAdmSyncSchema(env);
  await ensureAutomationSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT
        adm_sync_state.last_sync_status,
        adm_sync_state.last_sync_message,
        adm_sync_state.latest_adm_file,
        adm_sync_state.last_processed_file,
        adm_sync_state.last_processed_line,
        adm_sync_state.last_sync_at,
        adm_sync_state.last_lines_read,
        adm_sync_state.last_lines_processed,
        adm_sync_state.last_raw_events_stored,
        adm_sync_state.last_player_events_stored,
        adm_sync_state.last_kill_events_stored,
        adm_sync_state.last_events_created,
        adm_sync_state.last_kills_created,
        adm_sync_state.last_unknown_lines,
        adm_sync_state.last_duplicate_lines,
        adm_sync_state.last_sync_duration_ms,
        adm_sync_state.last_readable_route,
        adm_sync_state.last_raw_kill_lines_found,
        adm_sync_state.last_parsed_kill_lines_found,
        adm_sync_state.last_parser_skipped_lines,
        adm_sync_state.last_unreadable_files_queued,
        adm_sync_state.last_newest_unprocessed_adm_file,
        adm_sync_state.last_import_report_json,
        server_sync_state.last_adm_discovery_check_at,
        server_sync_state.next_adm_discovery_due_at,
        server_sync_state.last_successful_adm_discovery_at,
        server_sync_state.last_failed_adm_discovery_at,
        server_sync_state.last_adm_discovery_error,
        server_sync_state.adm_discovery_status,
        server_sync_state.next_adm_pull_due_at,
        server_sync_state.newest_available_adm_filename,
        server_sync_state.newest_available_adm_timestamp,
        server_sync_state.newest_readable_adm_filename,
        server_sync_state.newest_readable_adm_timestamp,
        server_sync_state.first_adm_after_restart_at,
        server_sync_state.first_adm_after_restart_delay_minutes,
        server_sync_state.first_useful_adm_line_after_restart_at,
        server_sync_state.observed_playerlist_interval_minutes,
        server_sync_state.observed_adm_cadence_minutes,
        server_sync_state.last_useful_adm_event_at,
        server_sync_state.last_playerlist_at,
        server_sync_state.nitrado_reduce_log_output_confirmed,
        server_sync_state.nitrado_log_playerlist_confirmed,
        server_sync_state.nitrado_log_settings_confirmed_at,
        server_sync_state.nitrado_log_settings_verification_source,
        server_sync_state.nitrado_admin_log_enabled,
        server_sync_state.nitrado_server_log_enabled,
        server_sync_state.nitrado_log_settings_last_checked_at,
        server_sync_state.nitrado_log_settings_last_error,
        server_stats.total_kills,
        server_stats.total_deaths,
        server_stats.total_joins,
        server_stats.total_disconnects,
        server_stats.unique_players
       FROM linked_servers
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE linked_servers.id = ? AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(linkedServer.id, userId)
    .first<Record<string, unknown>>();
  const [recentRuns, lastManualRun, lastScheduledRun, lastSuccessfulRun, unreadableQueued, newestUnprocessed] = await Promise.all([
    getRecentSyncRuns(env, linkedServer.id, 5),
    getLatestSyncRunByTrigger(env, linkedServer.id, "manual"),
    getLatestSyncRunByTrigger(env, linkedServer.id, "scheduled"),
    getLatestSuccessfulSyncRun(env, linkedServer.id),
    countQueuedUnreadableAdmFiles(env, linkedServer.id),
    getNewestUnprocessedAdmFile(env, linkedServer.id),
  ]);
  const currentStatus = stringOrDefault(row?.last_sync_status, "not_started");
  const newestAvailableAdmTimestamp = typeof row?.newest_available_adm_timestamp === "string" ? row.newest_available_adm_timestamp : null;
  const observedAdmCadenceMinutes = nullablePositiveInteger(row?.observed_adm_cadence_minutes);
  const lastCadenceAnchor = typeof row?.last_playerlist_at === "string"
    ? row.last_playerlist_at
    : typeof row?.last_useful_adm_event_at === "string"
      ? row.last_useful_adm_event_at
      : null;

  return {
    last_sync_status: currentStatus,
    last_sync_message: typeof row?.last_sync_message === "string" ? row.last_sync_message : null,
    latest_adm_file: typeof row?.latest_adm_file === "string" ? row.latest_adm_file : null,
    last_processed_file: typeof row?.last_processed_file === "string" ? row.last_processed_file : null,
    last_processed_line: numberOrZero(row?.last_processed_line),
    last_sync_at: typeof row?.last_sync_at === "string" ? row.last_sync_at : null,
    total_kills: numberOrZero(row?.total_kills),
    total_deaths: numberOrZero(row?.total_deaths),
    total_joins: numberOrZero(row?.total_joins),
    total_disconnects: numberOrZero(row?.total_disconnects),
    unique_players: numberOrZero(row?.unique_players),
    last_lines_read: numberOrZero(row?.last_lines_read),
    last_lines_processed: numberOrZero(row?.last_lines_processed),
    last_raw_events_stored: numberOrZero(row?.last_raw_events_stored),
    last_player_events_stored: numberOrZero(row?.last_player_events_stored),
    last_kill_events_stored: numberOrZero(row?.last_kill_events_stored),
    last_events_created: numberOrZero(row?.last_events_created),
    last_kills_created: numberOrZero(row?.last_kills_created),
    last_unknown_lines: numberOrZero(row?.last_unknown_lines),
    last_duplicate_lines: numberOrZero(row?.last_duplicate_lines),
    last_sync_duration_ms: row?.last_sync_duration_ms === null || row?.last_sync_duration_ms === undefined ? null : numberOrZero(row.last_sync_duration_ms),
    last_readable_route: typeof row?.last_readable_route === "string" ? row.last_readable_route : null,
    last_adm_discovery_check_at: typeof row?.last_adm_discovery_check_at === "string" ? row.last_adm_discovery_check_at : null,
    next_adm_discovery_due_at: typeof row?.next_adm_discovery_due_at === "string" ? row.next_adm_discovery_due_at : null,
    last_successful_adm_discovery_at: typeof row?.last_successful_adm_discovery_at === "string" ? row.last_successful_adm_discovery_at : null,
    last_failed_adm_discovery_at: typeof row?.last_failed_adm_discovery_at === "string" ? row.last_failed_adm_discovery_at : null,
    last_adm_discovery_error: typeof row?.last_adm_discovery_error === "string" ? row.last_adm_discovery_error : null,
    adm_discovery_status: typeof row?.adm_discovery_status === "string" ? row.adm_discovery_status : null,
    next_adm_pull_due_at: typeof row?.next_adm_pull_due_at === "string" ? row.next_adm_pull_due_at : null,
    newest_available_adm_filename: typeof row?.newest_available_adm_filename === "string" ? row.newest_available_adm_filename : null,
    newest_available_adm_timestamp: newestAvailableAdmTimestamp,
    newest_readable_adm_filename: typeof row?.newest_readable_adm_filename === "string" ? row.newest_readable_adm_filename : null,
    newest_readable_adm_timestamp: typeof row?.newest_readable_adm_timestamp === "string" ? row.newest_readable_adm_timestamp : null,
    first_adm_after_restart_at: typeof row?.first_adm_after_restart_at === "string" ? row.first_adm_after_restart_at : null,
    first_adm_after_restart_delay_minutes: nullablePositiveInteger(row?.first_adm_after_restart_delay_minutes),
    first_useful_adm_line_after_restart_at: typeof row?.first_useful_adm_line_after_restart_at === "string" ? row.first_useful_adm_line_after_restart_at : null,
    observed_playerlist_interval_minutes: nullablePositiveInteger(row?.observed_playerlist_interval_minutes),
    observed_adm_cadence_minutes: observedAdmCadenceMinutes,
    newest_adm_file_age_minutes: newestAvailableAdmTimestamp ? minutesSinceIso(newestAvailableAdmTimestamp) : null,
    last_useful_adm_event_at: typeof row?.last_useful_adm_event_at === "string" ? row.last_useful_adm_event_at : null,
    last_playerlist_at: typeof row?.last_playerlist_at === "string" ? row.last_playerlist_at : null,
    next_expected_adm_update_at: lastCadenceAnchor && observedAdmCadenceMinutes ? addMinutesToIso(lastCadenceAnchor, observedAdmCadenceMinutes) : null,
    nitrado_reduce_log_output_confirmed: Number(row?.nitrado_reduce_log_output_confirmed ?? 0) === 1,
    nitrado_log_playerlist_confirmed: Number(row?.nitrado_log_playerlist_confirmed ?? 0) === 1,
    nitrado_log_settings_confirmed_at: typeof row?.nitrado_log_settings_confirmed_at === "string" ? row.nitrado_log_settings_confirmed_at : null,
    nitrado_log_settings_verification_source: typeof row?.nitrado_log_settings_verification_source === "string" ? row.nitrado_log_settings_verification_source : null,
    nitrado_admin_log_enabled: nullableBoolean(row?.nitrado_admin_log_enabled),
    nitrado_server_log_enabled: nullableBoolean(row?.nitrado_server_log_enabled),
    nitrado_log_settings_last_checked_at: typeof row?.nitrado_log_settings_last_checked_at === "string" ? row.nitrado_log_settings_last_checked_at : null,
    nitrado_log_settings_last_error: typeof row?.nitrado_log_settings_last_error === "string" ? row.nitrado_log_settings_last_error : null,
    last_sync_trigger: recentRuns[0]?.trigger_type ?? null,
    last_scheduled_sync_at: lastScheduledRun?.finished_at ?? lastScheduledRun?.started_at ?? null,
    last_manual_sync_at: lastManualRun?.finished_at ?? lastManualRun?.started_at ?? null,
    last_successful_sync_at: lastSuccessfulRun?.finished_at ?? lastSuccessfulRun?.started_at ?? null,
    adm_health_label: getAdmHealthLabel(currentStatus),
    latest_adm_processed: typeof row?.last_processed_file === "string" ? row.last_processed_file : null,
    newest_unprocessed_adm_file: newestUnprocessed ?? (typeof row?.last_newest_unprocessed_adm_file === "string" ? row.last_newest_unprocessed_adm_file : null),
    unreadable_files_queued: unreadableQueued,
    raw_kill_lines_found: numberOrZero(row?.last_raw_kill_lines_found),
    parsed_kill_lines_found: numberOrZero(row?.last_parsed_kill_lines_found),
    parser_skipped_lines: numberOrZero(row?.last_parser_skipped_lines),
    last_adm_import_report: parseAdmDatabaseImportReport(row?.last_import_report_json),
    current_recovery_action: getAdmRecoveryAction(currentStatus, unreadableQueued),
    recent_sync_runs: recentRuns,
  };
}

export async function getRecentAdmSyncEvents(
  env: Env,
  userId: string,
  linkedServerId?: string | null,
  limit = 10,
): Promise<AdmRecentSyncEvent[]> {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 10, 1), 25);
  const result = await db
    .prepare(
      `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at, raw_line
       FROM (
         SELECT
           'kill' AS source,
           'player_killed' AS event_type,
           NULL AS player_name,
           killer_name,
           victim_name,
           weapon,
           distance,
           occurred_at,
           created_at,
           raw_line,
           COALESCE(occurred_at, created_at) AS sort_time
       FROM kill_events
       WHERE linked_server_id = ?
          AND (
            ? = 1
            OR (
              COALESCE(killer_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(killer_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(killer_name, '') NOT LIKE 'MockRunner%'
              AND COALESCE(victim_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(victim_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(victim_name, '') NOT LIKE 'MockRunner%'
            )
          )

         UNION ALL

         SELECT
           'player' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           raw_line,
           COALESCE(occurred_at, created_at) AS sort_time
       FROM player_events
       WHERE linked_server_id = ?
         AND (
            ? = 1
            OR (
              COALESCE(player_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(player_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(player_name, '') NOT LIKE 'MockRunner%'
            )
          )

         UNION ALL

         SELECT
           'build' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           COALESCE(tool, placed_class, build_part) AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           raw_line,
           COALESCE(occurred_at, created_at) AS sort_time
       FROM build_events
       WHERE linked_server_id = ?
          AND (
            ? = 1
            OR (
              COALESCE(player_name, '') NOT LIKE 'MockSurvivor%'
              AND COALESCE(player_name, '') NOT LIKE 'MockBandit%'
              AND COALESCE(player_name, '') NOT LIKE 'MockRunner%'
            )
          )
       )
       ORDER BY sort_time DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(
      linkedServer.id,
      isMockNitrado(env.MOCK_NITRADO) ? 1 : 0,
      linkedServer.id,
      isMockNitrado(env.MOCK_NITRADO) ? 1 : 0,
      linkedServer.id,
      isMockNitrado(env.MOCK_NITRADO) ? 1 : 0,
      safeLimit,
    )
    .all<AdmRecentSyncEvent & { raw_line?: string | null }>();

  return (result.results ?? []).map(toSafeRecentSyncEvent);
}

function toSafeRecentSyncEvent(row: AdmRecentSyncEvent & { raw_line?: string | null }): AdmRecentSyncEvent {
  const parsed = row.raw_line ? parseAdmLine(row.raw_line) : null;
  const eventType = row.event_type || parsed?.eventType || "unknown";
  const killerName = row.killer_name ?? parsed?.killerName ?? null;
  const victimName = row.victim_name ?? parsed?.victimName ?? null;
  const playerName = row.player_name ?? parsed?.playerName ?? parsed?.victimName ?? parsed?.attackerName ?? null;
  const weapon = row.weapon ?? parsed?.weapon ?? null;
  const distance = row.distance ?? parsed?.distance ?? null;
  const cause = parsed?.cause ?? syncEventCause(eventType);
  const objectType = parsed?.placedObject ?? parsed?.placedClass ?? parsed?.buildPart ?? parsed?.objectType ?? null;
  const isKill = row.source === "kill" || eventType === "player_killed";

  return {
    source: row.source,
    event_type: eventType,
    player_name: playerName,
    killer_name: killerName,
    victim_name: victimName,
    weapon,
    distance,
    occurred_at: row.occurred_at ?? parsed?.occurredAt ?? null,
    created_at: row.created_at,
    event_label: syncEventLabel(eventType, isKill),
    detail: syncEventDetail({
      eventType,
      isKill,
      playerName,
      killerName,
      victimName,
      attackerName: parsed?.attackerName ?? null,
      weapon,
      cause,
      objectType,
      tool: parsed?.tool ?? row.weapon ?? null,
    }),
    cause,
    object_type: objectType,
    is_mock: [playerName, killerName, victimName, parsed?.attackerName].some(isMockPlayerName),
  };
}

function syncEventLabel(eventType: string, isKill: boolean) {
  if (isKill) return "PvP Kill";
  const labels: Record<string, string> = {
    player_connected: "Connected",
    player_disconnected: "Disconnected",
    player_died_stats: "Died",
    player_killed_environment: "Died",
    built: "Built Structure",
    placed: "Placed Build Item",
    dismantled: "Dismantled",
    player_built_structure: "Built Structure",
    player_dismantled_structure: "Dismantled",
    player_suicide: "Suicide",
    player_hit: "Hit",
    player_hit_explosion: "Hit",
    player_hit_unknown_attacker: "Hit",
    player_placed_object: "Placed Object",
    player_connecting: "Connecting",
    player_unconscious: "Unconscious",
    player_regained_consciousness: "Regained Consciousness",
    player_choosing_respawn: "Choosing Respawn",
    player_performed_action: "Action",
    playerlist_entry: "Player Snapshot",
    plain_player_state: "Player Snapshot",
  };
  return labels[eventType] ?? formatSyncEventType(eventType);
}

function syncEventCause(eventType: string) {
  if (eventType === "player_suicide") return "Suicide";
  if (eventType === "player_died_stats") return "Death stats";
  return null;
}

function syncEventDetail(values: {
  eventType: string;
  isKill: boolean;
  playerName: string | null;
  killerName: string | null;
  victimName: string | null;
  attackerName: string | null;
  weapon: string | null;
  cause: string | null;
  objectType: string | null;
  tool?: string | null;
}) {
  if (values.isKill) return `${values.killerName ?? "Unknown"} -> ${values.victimName ?? "Unknown"}`;
  if (values.eventType === "player_hit") return `${values.attackerName ?? "Unknown"} hit ${values.victimName ?? values.playerName ?? "Unknown"}`;
  if (values.eventType === "player_hit_explosion") return `${values.playerName ?? "Unknown"} hit by explosion`;
  if (values.eventType === "player_hit_unknown_attacker") return `${values.playerName ?? values.victimName ?? "Unknown"} hit by unknown attacker`;
  if (values.eventType === "player_killed_environment") return `${values.victimName ?? values.playerName ?? "Unknown"} died${values.cause ? `: ${values.cause}` : ""}`;
  if (values.eventType === "player_suicide") return `${values.playerName ?? "Unknown"} committed suicide`;
  if (values.eventType === "built" || values.eventType === "player_built_structure") {
    return `${values.playerName ?? "Unknown"} built ${values.objectType ?? "a structure"}${values.tool ? ` with ${values.tool}` : ""}`;
  }
  if (values.eventType === "placed" || values.eventType === "player_placed_object") {
    return `${values.playerName ?? "Unknown"} placed ${values.objectType ?? "a build item"}`;
  }
  if (values.eventType === "dismantled" || values.eventType === "player_dismantled_structure") {
    return `${values.playerName ?? "Unknown"} dismantled ${values.objectType ?? "a structure"}${values.tool ? ` with ${values.tool}` : ""}`;
  }
  if (values.eventType === "player_placed_object") return `${values.playerName ?? "Unknown"} placed ${values.objectType ?? "an object"}`;
  return values.playerName ?? values.victimName ?? null;
}

function formatSyncEventType(value: string) {
  return value
    .replace(/^player_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isMockPlayerName(value: string | null | undefined) {
  return /^Mock(Survivor|Bandit|Runner)/.test(value ?? "");
}

export async function clearMockTestSyncData(env: Env, userId: string, linkedServerId?: string | null) {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  await db
    .prepare(
      `DELETE FROM adm_raw_events
       WHERE linked_server_id = ?
         AND (
           raw_line LIKE '%MockSurvivor%'
           OR raw_line LIKE '%MockBandit%'
           OR raw_line LIKE '%MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM kill_events
       WHERE linked_server_id = ?
         AND (
           COALESCE(killer_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(killer_name, '') LIKE 'MockBandit%'
           OR COALESCE(killer_name, '') LIKE 'MockRunner%'
           OR COALESCE(victim_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(victim_name, '') LIKE 'MockBandit%'
           OR COALESCE(victim_name, '') LIKE 'MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM player_events
       WHERE linked_server_id = ?
         AND (
           COALESCE(player_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(player_name, '') LIKE 'MockBandit%'
           OR COALESCE(player_name, '') LIKE 'MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM build_events
       WHERE linked_server_id = ?
         AND (
           COALESCE(player_name, '') LIKE 'MockSurvivor%'
           OR COALESCE(player_name, '') LIKE 'MockBandit%'
           OR COALESCE(player_name, '') LIKE 'MockRunner%'
         )`,
    )
    .bind(linkedServer.id)
    .run();
  await db
    .prepare(
      `DELETE FROM player_profiles
       WHERE linked_server_id = ?
         AND (
           player_name LIKE 'MockSurvivor%'
           OR player_name LIKE 'MockBandit%'
           OR player_name LIKE 'MockRunner%'
           OR COALESCE(player_id, '') LIKE 'mock-player-%'
         )`,
    )
    .bind(linkedServer.id)
    .run();

  const remaining = await countRemainingSyncRows(env, linkedServer.id);
  if (remaining === 0) {
    await db.prepare("DELETE FROM server_stats WHERE linked_server_id = ?").bind(linkedServer.id).run();
    await db.prepare("DELETE FROM server_build_stats WHERE linked_server_id = ?").bind(linkedServer.id).run();
    await db.prepare("DELETE FROM adm_sync_state WHERE linked_server_id = ?").bind(linkedServer.id).run();
  } else {
    await rebuildServerStats(env, linkedServer.id);
    await rebuildServerBuildStats(env, linkedServer.id);
  }

  return { ok: true, remainingRows: remaining };
}

export async function clearOldFailedSyncRuns(env: Env, userId: string, linkedServerId?: string | null) {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");

  const db = requireDb(env);
  const latestSuccess = await db
    .prepare(
      `SELECT COALESCE(finished_at, started_at, created_at) AS sync_time
       FROM sync_runs
       WHERE linked_server_id = ?
         AND lower(status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT 1`,
    )
    .bind(linkedServer.id)
    .first<{ sync_time: string | null }>();

  if (!latestSuccess?.sync_time) {
    return { ok: true, deletedCount: 0 };
  }

  const result = await db
    .prepare(
      `DELETE FROM sync_runs
       WHERE linked_server_id = ?
         AND lower(status) IN ('error', 'failed')
         AND COALESCE(finished_at, started_at, created_at) < ?`,
    )
    .bind(linkedServer.id, latestSuccess.sync_time)
    .run();

  return { ok: true, deletedCount: numberOrZero(result.meta?.changes) };
}

export type AdmDiscoveryResult = {
  ok: boolean;
  status: string;
  message: string;
  newestAvailableAdmFile: string | null;
  newestAvailableAdmTimestamp: string | null;
  newestReadableAdmFile: string | null;
  newestReadableAdmTimestamp: string | null;
  filesFound: number;
  readableFilesFound: number;
};

export async function runAdmDiscoveryForLinkedServer(env: Env, userId: string, linkedServerId: string): Promise<AdmDiscoveryResult> {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");
  const initialScope = verifyAdmServerScope(linkedServer, crypto.randomUUID());
  const existingState = await getSyncState(env, initialScope.linkedServerId);
  const isMock = isMockNitrado(env.MOCK_NITRADO);
  const preferredAdmPath = existingState?.latest_adm_path ?? linkedServer.adm_path ?? null;
  const preferredAdmFileName = existingState?.latest_adm_file ?? fileNameFromPath(preferredAdmPath);

  try {
    const batch = await getReadableAdmFilesForLinkedServer(env, linkedServer, {
      isMock,
      readMode: "sample",
      preferredAdmPath,
      previousLatestAdmFileName: preferredAdmFileName,
      maxFiles: 6,
    });
    await recordDiscoveredAdmFiles(env, initialScope, batch.candidates);
    const newestAvailableAdm = selectNewestDiscoveredAdmFile(batch.candidates) ?? (batch.newestAdmFileName ? {
      name: batch.newestAdmFileName,
      path: preferredAdmPath,
      timestamp: extractAdmTimestampScore(batch.newestAdmFileName),
    } : null);
    const newestReadableAdm = selectNewestReadableAdmFile(batch.files);
    const newestAvailableAdmTimestamp = timestampIso(newestAvailableAdm?.timestamp ?? extractAdmTimestampScore(newestAvailableAdm?.name));
    const newestReadableAdmTimestamp = timestampIso(newestReadableAdm ? extractAdmTimestampScore(newestReadableAdm.name) : null);
    const hasNewAvailable = Boolean(newestAvailableAdm?.name && newestAvailableAdm.name !== existingState?.latest_adm_file);
    const status = newestReadableAdm
      ? (hasNewAvailable ? "new_adm_readable" : "no_new_log_available")
      : classifyUnavailableAdmFileStatus(newestAvailableAdm?.name ?? batch.newestAdmFileName, batch.filesFound > 0, batch.apiStatus);
    const normalizedStatus = normalizeAdmSyncStateMachineStatus(status);
    return {
      ok: !isAdmSyncErrorStatus(status),
      status: normalizedStatus === "latest_adm_unreadable" ? "latest_adm_unreadable" : normalizedStatus,
      message: newestReadableAdm ? batch.message : getUnavailableAdmMessage(status),
      newestAvailableAdmFile: newestAvailableAdm?.name ?? batch.newestAdmFileName ?? null,
      newestAvailableAdmTimestamp,
      newestReadableAdmFile: newestReadableAdm?.name ?? null,
      newestReadableAdmTimestamp,
      filesFound: batch.filesFound,
      readableFilesFound: batch.files.length,
    };
  } catch (error) {
    const latestAdmFile = existingState?.latest_adm_file ?? fileNameFromPath(preferredAdmPath);
    const status = classifyNitradoExceptionStatus(error, latestAdmFile);
    return {
      ok: !isAdmSyncErrorStatus(status),
      status: normalizeAdmSyncStateMachineStatus(status),
      message: status === "adm_file_unreadable"
        ? "Latest ADM file found but not readable yet. DZN will retry on the next scheduled check."
        : getUnavailableAdmMessage(status),
      newestAvailableAdmFile: latestAdmFile,
      newestAvailableAdmTimestamp: timestampIso(extractAdmTimestampScore(latestAdmFile)),
      newestReadableAdmFile: null,
      newestReadableAdmTimestamp: null,
      filesFound: latestAdmFile ? 1 : 0,
      readableFilesFound: 0,
    };
  }
}

export type ScheduledAdmSyncResult = {
  ok: true;
  processed: number;
  succeeded: number;
  failed: number;
  unavailable: number;
  skipped: number;
  discovery_due_count: number;
  discovery_processed_count: number;
  processing_due_count: number;
  processing_processed_count: number;
  skipped_not_due: number;
  skipped_locked: number;
  skipped_unreadable: number;
  waiting_after_restart_count: number;
  latest_adm_unreadable_count: number;
  new_adm_readable_count: number;
  new_data_found_count: number;
  cron: string | null;
  maxServers: number;
  maxLinesPerServer: number;
  metadata: ScheduledMetadataSyncResult;
};

export async function runScheduledAdmSync(
  env: Env,
  options: {
    cron?: string | null;
    maxServers?: number;
    maxLinesPerServer?: number;
    minSyncIntervalMs?: number;
  } = {},
): Promise<ScheduledAdmSyncResult> {
  await ensureAdmSyncSchema(env);
  const maxServers = clampPositiveInteger(options.maxServers ?? 10, 10);
  const maxLinesPerServer = clampPositiveInteger(options.maxLinesPerServer ?? 50000, 50000);
  const minSyncIntervalMs = Math.max(clampPositiveInteger(options.minSyncIntervalMs ?? 10 * 60 * 1000, 10 * 60 * 1000), 10 * 60 * 1000);
  const metadata = await refreshLivePlayerCountsForActiveServers(env, {
    maxServers,
    skipFreshWithinMs: 5 * 60 * 1000,
  });
  const discoveryServers = await getDueAdmDiscoveryAutomationServers(env, maxServers);
  const discoveryResults = new Map<string, AdmDiscoveryResult>();
  let discoveryProcessed = 0;
  let skippedUnreadable = 0;
  let waitingAfterRestartCount = 0;
  let latestAdmUnreadableCount = 0;
  let newAdmReadableCount = 0;

  for (const server of discoveryServers) {
    try {
      const discovery = await runAdmDiscoveryForLinkedServer(env, server.user_id, server.id);
      discoveryResults.set(server.guild_id, discovery);
      discoveryProcessed += 1;
      if (discovery.status === "waiting_after_restart" || discovery.status === "delayed_after_restart") waitingAfterRestartCount += 1;
      if (discovery.status === "latest_adm_unreadable") latestAdmUnreadableCount += 1;
      if (discovery.status === "new_adm_readable") newAdmReadableCount += 1;
      await recordAdmDiscoveryResult(env, {
        guildId: server.guild_id,
        planKey: server.plan_key,
        ok: discovery.ok,
        status: discovery.status,
        error: discovery.ok ? null : discovery.message,
        newestAvailableAdmFile: discovery.newestAvailableAdmFile,
        newestAvailableAdmTimestamp: discovery.newestAvailableAdmTimestamp,
        newestReadableAdmFile: discovery.newestReadableAdmFile,
        newestReadableAdmTimestamp: discovery.newestReadableAdmTimestamp,
      });
    } catch (error) {
      await recordAdmDiscoveryResult(env, {
        guildId: server.guild_id,
        planKey: server.plan_key,
        ok: false,
        status: "failed",
        error: safeSyncErrorMessage(error),
      }).catch(() => null);
    }
  }

  const eligibleServers = await getDueAdmAutomationServers(env, maxServers, minSyncIntervalMs);
  let succeeded = 0;
  let failed = 0;
  let unavailable = 0;
  let processingProcessed = 0;
  let newDataFoundCount = 0;

  for (const server of eligibleServers) {
    const discoveredReadable = discoveryResults.get(server.guild_id)?.newestReadableAdmFile ?? server.newest_readable_adm_filename ?? null;
    if (!discoveredReadable) {
      skippedUnreadable += 1;
      continue;
    }
    try {
      await markAdmPullStarted(env, server.guild_id);
      processingProcessed += 1;
      const result = await runAdmSync(env, server.user_id, server.id, {
        triggerType: "scheduled",
        maxLinesPerRun: maxLinesPerServer,
      });
      const ok = !isAdmSyncErrorStatus(result.status);
      if (!ok) failed += 1;
      else {
        if (isAdmSyncTemporarilyUnavailableStatus(result.status)) unavailable += 1;
        succeeded += 1;
      }
      await recordAdmPullResult(env, {
        guildId: server.guild_id,
        planKey: server.plan_key,
        ok,
        status: result.status,
        error: ok ? null : result.message,
        latestAdmFile: result.latestAdmFile,
        latestAdmTimestamp: result.latestAdmTimestamp ?? null,
        newestAvailableAdmFile: result.newestAvailableAdmFile ?? result.latestAdmFile,
        newestAvailableAdmTimestamp: result.newestAvailableAdmTimestamp ?? result.latestAdmTimestamp ?? null,
        newestReadableAdmFile: result.newestReadableAdmFile ?? null,
        newestReadableAdmTimestamp: result.newestReadableAdmTimestamp ?? null,
        firstUsefulAdmLineAt: result.firstUsefulAdmLineAt ?? null,
        lastUsefulAdmEventAt: result.lastUsefulAdmEventAt ?? null,
        lastPlayerlistAt: result.lastPlayerlistAt ?? null,
        processedAdmFile: result.latestAdmFile,
        processedOffset: result.lastProcessedLine,
        processedLine: result.lastProcessedLine,
        newDataFound: result.eventsCreated > 0 || result.killsCreated > 0 || result.buildEventsStored > 0,
      });
      if (result.eventsCreated > 0 || result.killsCreated > 0 || result.buildEventsStored > 0) newDataFoundCount += 1;
      if (ok) {
        let publicCacheUpdated = false;
        let discordQueuesCreated = 0;
        let cacheRefreshStatus: AdmDatabaseImportReport["cacheRefreshStatus"] = "skipped";
        let discordQueueStatus: AdmDatabaseImportReport["discordQueueStatus"] = "skipped";
        await upsertServerPublicCache(env, {
          guildId: server.guild_id,
          planKey: server.plan_key,
          publicServerName: firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name),
          lastAdmUpdateAt: result.lastSyncAt,
        });
        publicCacheUpdated = true;
        cacheRefreshStatus = "updated";
        if (result.eventsCreated > 0 || result.killsCreated > 0) {
          discordQueuesCreated = await queueDiscordPostUpdatesForGuild(env, server.guild_id, server.plan_key, [
            "leaderboard_embed",
            "daily_summary_embed",
            "event_leaderboard_embed",
            "network_ranking_embed",
            "server_vs_server_embed",
            "killfeed_embed",
            "pve_feed_embed",
            "hit_feed_embed",
            "connection_feed_embed",
            "build_feed_embed",
            "admin_alerts_embed",
            "admin_logs_embed",
          ], "adm-data-change");
          discordQueueStatus = discordQueuesCreated > 0 ? "queued" : "skipped";
        }
        await updateLastAdmImportReport(env, server.id, {
          publicCacheUpdated,
          discordQueuesCreated,
          cacheRefreshStatus,
          discordQueueStatus,
        });
      }
    } catch (error) {
      failed += 1;
      await recordAdmPullResult(env, {
        guildId: server.guild_id,
        planKey: server.plan_key,
        ok: false,
        status: "failed",
        error: safeSyncErrorMessage(error),
      }).catch(() => null);
      await recordSyncRun(env, {
        linkedServerId: server.id,
        sourceServiceId: server.nitrado_service_id,
        triggerType: "scheduled",
        status: "error",
        message: safeSyncErrorMessage(error),
        linesRead: 0,
        linesProcessed: 0,
        eventsCreated: 0,
        killsCreated: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      });
    }
  }

  return {
    ok: true,
    processed: processingProcessed,
    succeeded,
    failed,
    unavailable,
    skipped: Math.max(0, maxServers - processingProcessed),
    discovery_due_count: discoveryServers.length,
    discovery_processed_count: discoveryProcessed,
    processing_due_count: eligibleServers.length,
    processing_processed_count: processingProcessed,
    skipped_not_due: Math.max(0, maxServers - Math.max(discoveryServers.length, eligibleServers.length)),
    skipped_locked: 0,
    skipped_unreadable: skippedUnreadable,
    waiting_after_restart_count: waitingAfterRestartCount,
    latest_adm_unreadable_count: latestAdmUnreadableCount,
    new_adm_readable_count: newAdmReadableCount,
    new_data_found_count: newDataFoundCount,
    cron: options.cron ?? null,
    maxServers,
    maxLinesPerServer,
    metadata,
  };
}

export async function ensureAdmSyncSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of ADM_SYNC_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
  await ensureAdmSyncDetailColumns(env);
  await ensureBuildEventSchema(env);
}

async function getOwnedLinkedServer(env: Env, userId: string, linkedServerId?: string | null): Promise<SyncLinkedServer | null> {
  if (!linkedServerId) {
    const current = await getCurrentLinkedServer(env, userId, { includePrivateAdmPath: true });
    if (!current || typeof current.id !== "string") return null;
    return {
      id: current.id,
      user_id: userId,
      nitrado_service_id: typeof current.nitrado_service_id === "string" ? current.nitrado_service_id : null,
      adm_path: typeof current.adm_path === "string" ? current.adm_path : null,
    };
  }

  const db = requireDb(env);
  return db
    .prepare(
      `SELECT
         linked_servers.id,
         linked_servers.user_id,
         linked_servers.nitrado_service_id,
         linked_servers.server_name,
         linked_servers.display_name,
         linked_servers.hostname,
         linked_servers.nitrado_service_name,
         server_log_config.adm_path AS adm_path
       FROM linked_servers
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       WHERE linked_servers.id = ? AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId, userId)
    .first<SyncLinkedServer>();
}

async function ensureAdmSyncDetailColumns(env: Env) {
  const db = requireDb(env);
  await ensureMissingColumns(db, "adm_sync_state", [
    ["last_lines_read", "INTEGER DEFAULT 0"],
    ["last_lines_processed", "INTEGER DEFAULT 0"],
    ["last_raw_events_stored", "INTEGER DEFAULT 0"],
    ["last_player_events_stored", "INTEGER DEFAULT 0"],
    ["last_kill_events_stored", "INTEGER DEFAULT 0"],
    ["last_events_created", "INTEGER DEFAULT 0"],
    ["last_kills_created", "INTEGER DEFAULT 0"],
    ["last_unknown_lines", "INTEGER DEFAULT 0"],
    ["last_duplicate_lines", "INTEGER DEFAULT 0"],
    ["last_sync_duration_ms", "INTEGER"],
    ["last_readable_route", "TEXT"],
    ["source_service_id", "TEXT"],
    ["last_raw_kill_lines_found", "INTEGER DEFAULT 0"],
    ["last_parsed_kill_lines_found", "INTEGER DEFAULT 0"],
    ["last_parser_skipped_lines", "INTEGER DEFAULT 0"],
    ["last_unreadable_files_queued", "INTEGER DEFAULT 0"],
    ["last_newest_unprocessed_adm_file", "TEXT"],
    ["last_import_report_json", "TEXT"],
    ["last_processed_adm_line_hash", "TEXT"],
    ["last_processed_adm_line_text_preview", "TEXT"],
    ["last_cursor_validation_status", "TEXT"],
    ["last_cursor_validation_error", "TEXT"],
    ["last_cursor_validation_at", "TEXT"],
    ["cursor_recovery_strategy", "TEXT"],
    ["cursor_recovery_reason", "TEXT"],
  ]);
  await ensureMissingColumns(db, "adm_raw_events", [
    ["source_service_id", "TEXT"],
    ["source_adm_file", "TEXT"],
    ["source_line_number", "INTEGER"],
    ["source_sync_run_id", "TEXT"],
  ]);
  await ensureMissingColumns(db, "player_events", [
    ["source_service_id", "TEXT"],
    ["source_adm_file", "TEXT"],
    ["source_line_number", "INTEGER"],
    ["source_sync_run_id", "TEXT"],
  ]);
  await ensureMissingColumns(db, "kill_events", [
    ["source_service_id", "TEXT"],
    ["source_adm_file", "TEXT"],
    ["source_line_number", "INTEGER"],
    ["source_sync_run_id", "TEXT"],
  ]);
  await ensureMissingColumns(db, "player_profiles", [["source_service_id", "TEXT"]]);
  await ensureMissingColumns(db, "server_stats", [["source_service_id", "TEXT"]]);
  await ensureMissingColumns(db, "sync_runs", [["source_service_id", "TEXT"]]);
  for (const statement of ADM_SYNC_SCOPE_INDEX_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

async function ensureMissingColumns(db: D1Database, table: string, columns: string[][]) {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const existing = new Set((result.results ?? []).map((column) => column.name));
  for (const [name, type] of columns) {
    if (!existing.has(name)) {
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
    }
  }
}

async function getSyncState(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  return db
    .prepare("SELECT * FROM adm_sync_state WHERE linked_server_id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<AdmSyncState>();
}

async function upsertSyncState(
  env: Env,
  linkedServerId: string,
  values: {
    latestAdmFile: string | null;
    latestAdmPath: string | null;
    sourceServiceId: string;
    lastProcessedFile: string | null;
    lastProcessedLine: number;
    lastProcessedOffset: number;
    status: string;
    message: string;
    lastSyncAt: string;
    linesRead: number;
    linesProcessed: number;
    rawEventsStored: number;
    playerEventsStored: number;
    killEventsStored: number;
    eventsCreated: number;
    killsCreated: number;
    unknownLines: number;
    duplicateLines: number;
    syncDurationMs: number;
    readableRoute: string | null;
    rawKillLinesFound?: number;
    parsedKillLinesFound?: number;
    parserSkippedLines?: number;
    unreadableFilesQueued?: number;
    newestUnprocessedAdmFile?: string | null;
    importReportJson?: string | null;
    lastProcessedAdmLineHash?: string | null;
    lastProcessedAdmLineTextPreview?: string | null;
    lastCursorValidationStatus?: string | null;
    lastCursorValidationError?: string | null;
    lastCursorValidationAt?: string | null;
    cursorRecoveryStrategy?: string | null;
    cursorRecoveryReason?: string | null;
  },
) {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO adm_sync_state (
        id, linked_server_id, source_service_id, latest_adm_file, latest_adm_path, last_processed_file,
        last_processed_line, last_processed_offset, last_sync_status, last_sync_message,
        last_sync_at, last_lines_read, last_lines_processed, last_raw_events_stored,
        last_player_events_stored, last_kill_events_stored, last_events_created,
        last_kills_created, last_unknown_lines, last_duplicate_lines, last_sync_duration_ms,
        last_readable_route, last_raw_kill_lines_found, last_parsed_kill_lines_found,
        last_parser_skipped_lines, last_unreadable_files_queued, last_newest_unprocessed_adm_file,
        last_import_report_json, last_processed_adm_line_hash, last_processed_adm_line_text_preview,
        last_cursor_validation_status, last_cursor_validation_error, last_cursor_validation_at,
        cursor_recovery_strategy, cursor_recovery_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        source_service_id = COALESCE(excluded.source_service_id, adm_sync_state.source_service_id),
        latest_adm_file = excluded.latest_adm_file,
        latest_adm_path = excluded.latest_adm_path,
        last_processed_file = excluded.last_processed_file,
        last_processed_line = excluded.last_processed_line,
        last_processed_offset = excluded.last_processed_offset,
        last_sync_status = excluded.last_sync_status,
        last_sync_message = excluded.last_sync_message,
        last_sync_at = excluded.last_sync_at,
        last_lines_read = excluded.last_lines_read,
        last_lines_processed = excluded.last_lines_processed,
        last_raw_events_stored = excluded.last_raw_events_stored,
        last_player_events_stored = excluded.last_player_events_stored,
        last_kill_events_stored = excluded.last_kill_events_stored,
        last_events_created = excluded.last_events_created,
        last_kills_created = excluded.last_kills_created,
        last_unknown_lines = excluded.last_unknown_lines,
        last_duplicate_lines = excluded.last_duplicate_lines,
        last_sync_duration_ms = excluded.last_sync_duration_ms,
        last_readable_route = excluded.last_readable_route,
        last_raw_kill_lines_found = excluded.last_raw_kill_lines_found,
        last_parsed_kill_lines_found = excluded.last_parsed_kill_lines_found,
        last_parser_skipped_lines = excluded.last_parser_skipped_lines,
        last_unreadable_files_queued = excluded.last_unreadable_files_queued,
        last_newest_unprocessed_adm_file = excluded.last_newest_unprocessed_adm_file,
        last_import_report_json = COALESCE(excluded.last_import_report_json, adm_sync_state.last_import_report_json),
        last_processed_adm_line_hash = COALESCE(excluded.last_processed_adm_line_hash, adm_sync_state.last_processed_adm_line_hash),
        last_processed_adm_line_text_preview = COALESCE(excluded.last_processed_adm_line_text_preview, adm_sync_state.last_processed_adm_line_text_preview),
        last_cursor_validation_status = COALESCE(excluded.last_cursor_validation_status, adm_sync_state.last_cursor_validation_status),
        last_cursor_validation_error = excluded.last_cursor_validation_error,
        last_cursor_validation_at = COALESCE(excluded.last_cursor_validation_at, adm_sync_state.last_cursor_validation_at),
        cursor_recovery_strategy = excluded.cursor_recovery_strategy,
        cursor_recovery_reason = excluded.cursor_recovery_reason,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      values.sourceServiceId,
      values.latestAdmFile,
      values.latestAdmPath,
      values.lastProcessedFile,
      values.lastProcessedLine,
      values.lastProcessedOffset,
      values.status,
      values.message,
      values.lastSyncAt,
      values.linesRead,
      values.linesProcessed,
      values.rawEventsStored,
      values.playerEventsStored,
      values.killEventsStored,
      values.eventsCreated,
      values.killsCreated,
      values.unknownLines,
      values.duplicateLines,
      values.syncDurationMs,
      values.readableRoute,
      values.rawKillLinesFound ?? 0,
      values.parsedKillLinesFound ?? 0,
      values.parserSkippedLines ?? 0,
      values.unreadableFilesQueued ?? 0,
      values.newestUnprocessedAdmFile ?? null,
      values.importReportJson ?? null,
      values.lastProcessedAdmLineHash ?? null,
      values.lastProcessedAdmLineTextPreview ?? null,
      values.lastCursorValidationStatus ?? null,
      values.lastCursorValidationError ?? null,
      values.lastCursorValidationAt ?? null,
      values.cursorRecoveryStrategy ?? null,
      values.cursorRecoveryReason ?? null,
    )
    .run();
}

async function recordDiscoveredAdmFiles(env: Env, context: AdmSyncContext, files: DiscoveredAdmFileForSync[]) {
  for (const file of files) {
    await recordAdmFileAttempt(env, context, file, {
      status: "discovered",
      lineCount: 0,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      insertedKills: 0,
      parserSkippedLines: 0,
      message: null,
    });
  }
}

async function recordAdmFileAttempt(
  env: Env,
  context: AdmSyncContext,
  file: DiscoveredAdmFileForSync,
  values: {
    status: "discovered" | "unreadable" | "parser_error" | "write_error" | "processed" | "partial";
    lineCount: number;
    rawKillLinesFound: number;
    parsedKillLinesFound: number;
    insertedKills: number;
    parserSkippedLines: number;
    lastLineProcessed?: number;
    message: string | null;
  },
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO adm_sync_file_state (
        id, linked_server_id, source_service_id, adm_file, adm_path, status,
        first_seen_at, last_checked_at, last_readable_at, processed_at, line_count,
        last_line_processed, raw_kill_lines_found, parsed_kill_lines_found,
        inserted_kills, parser_skipped_lines, retry_count, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(linked_server_id, source_service_id, adm_file) DO UPDATE SET
        adm_path = COALESCE(excluded.adm_path, adm_sync_file_state.adm_path),
        status = CASE
          WHEN adm_sync_file_state.ignored_at IS NOT NULL THEN adm_sync_file_state.status
          WHEN excluded.status = 'discovered' AND adm_sync_file_state.status IN ('processed', 'partial') THEN adm_sync_file_state.status
          ELSE excluded.status
        END,
        last_checked_at = excluded.last_checked_at,
        last_readable_at = COALESCE(excluded.last_readable_at, adm_sync_file_state.last_readable_at),
        processed_at = COALESCE(excluded.processed_at, adm_sync_file_state.processed_at),
        line_count = MAX(COALESCE(adm_sync_file_state.line_count, 0), excluded.line_count),
        last_line_processed = MAX(COALESCE(adm_sync_file_state.last_line_processed, 0), excluded.last_line_processed),
        raw_kill_lines_found = excluded.raw_kill_lines_found,
        parsed_kill_lines_found = excluded.parsed_kill_lines_found,
        inserted_kills = excluded.inserted_kills,
        parser_skipped_lines = excluded.parser_skipped_lines,
        retry_count = CASE
          WHEN excluded.status = 'unreadable' THEN COALESCE(adm_sync_file_state.retry_count, 0) + 1
          ELSE COALESCE(adm_sync_file_state.retry_count, 0)
        END,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      context.linkedServerId,
      context.nitradoServiceId,
      file.name,
      file.path,
      values.status,
      now,
      now,
      values.status === "processed" || values.status === "partial" ? now : null,
      values.status === "processed" ? now : null,
      values.lineCount,
      values.lastLineProcessed ?? 0,
      values.rawKillLinesFound,
      values.parsedKillLinesFound,
      values.insertedKills,
      values.parserSkippedLines,
      values.status === "unreadable" ? 1 : 0,
      values.message,
      now,
    )
    .run();
}

async function countQueuedUnreadableAdmFiles(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM adm_sync_file_state
       WHERE linked_server_id = ?
         AND ignored_at IS NULL
         AND status IN ('unreadable', 'parser_error', 'write_error', 'partial')`,
    )
    .bind(linkedServerId)
    .first<{ count: number }>();
  return numberOrZero(row?.count);
}

async function getNewestUnprocessedAdmFile(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT adm_file
       FROM adm_sync_file_state
       WHERE linked_server_id = ?
         AND ignored_at IS NULL
         AND status IN ('discovered', 'unreadable', 'parser_error', 'write_error', 'partial')
       ORDER BY adm_file DESC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ adm_file: string }>();
  return row?.adm_file ?? null;
}

async function insertRawEvent(
  env: Env,
  context: AdmSyncContext,
  lineNumber: number,
  rawLine: string,
  parsed: ParsedAdmEvent,
) {
  const admFile = context.admFileName;
  assertAdmWriteScope(context, {
    linkedServerId: context.linkedServerId,
    sourceServiceId: context.nitradoServiceId,
    sourceAdmFile: admFile,
  }, "adm_raw_events");
  const db = requireDb(env);
  const id = await stableSyncId("raw", context.linkedServerId, admFile, lineNumber);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO adm_raw_events (
        id, linked_server_id, source_service_id, adm_file, source_adm_file, line_number,
        source_line_number, source_sync_run_id, raw_line, event_type, parsed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      context.linkedServerId,
      context.nitradoServiceId,
      admFile,
      admFile,
      lineNumber,
      lineNumber,
      context.syncRunId ?? null,
      rawLine,
      parsed.eventType,
      parsed.eventType === "unknown" ? 0 : 1,
    )
    .run();
  return didMutate(result);
}

async function persistParsedEvent(
  env: Env,
  syncContext: AdmSyncContext,
  lineNumber: number,
  parsed: ParsedAdmEvent,
  deathContext: { recentDeathLines: Map<string, number> },
) {
  if (
    parsed.eventType === "admin_log_started" ||
    parsed.eventType === "playerlist_snapshot" ||
    parsed.eventType === "playerlist_delimiter" ||
    parsed.eventType === "unknown"
  ) {
    return emptyPersistResult();
  }

  if (parsed.eventType === "playerlist_entry" || parsed.eventType === "plain_player_state") {
    let playerProfileId: string | null = null;
    if (parsed.playerName) {
      playerProfileId = await upsertPlayerProfile(env, syncContext, parsed.playerName, parsed.playerId, parsed.occurredAt);
    }
    const inserted = await insertPlayerEvent(env, syncContext, playerProfileId, lineNumber, parsed);
    return {
      ...emptyPersistResult(),
      eventsCreated: inserted ? 1 : 0,
      playerEventsCreated: inserted ? 1 : 0,
    };
  }

  const result = emptyPersistResult();

  if (parsed.eventType === "player_killed" && parsed.isCreditedKill) {
    const killerProfileId = parsed.killerName
      ? await upsertPlayerProfile(env, syncContext, parsed.killerName, parsed.killerId, parsed.occurredAt)
      : null;
    const victimProfileId = parsed.victimName
      ? await upsertPlayerProfile(env, syncContext, parsed.victimName, parsed.victimId, parsed.occurredAt)
      : null;
    const inserted = await insertKillEvent(env, syncContext, killerProfileId, victimProfileId, lineNumber, parsed);
    if (inserted) {
      await updateProfilesForDeath(env, {
        killerProfileId,
        victimProfileId,
        killerGetsKill: true,
        suicide: false,
        distance: parsed.distance,
      });
      result.eventsCreated = 1;
      result.killEventsCreated = 1;
      result.killsCreated = 1;
      result.deathsCreated = 1;
    }
    markDeathCounted(deathContext.recentDeathLines, parsed, lineNumber);
    return result;
  }

  if (isParsedBuildEvent(parsed)) {
    if (parsed.playerName) {
      await upsertPlayerProfile(env, syncContext, parsed.playerName, parsed.playerId, parsed.occurredAt);
    }
    const inserted = await insertBuildEvent(env, syncContext, lineNumber, parsed);
    if (inserted) {
      result.eventsCreated = 1;
      result.buildEventsCreated = 1;
    }
    return result;
  }

  const eventPlayer = getPlayerForPlayerEvent(parsed);
  let playerProfileId: string | null = null;
  if (eventPlayer.name) {
    playerProfileId = await upsertPlayerProfile(env, syncContext, eventPlayer.name, eventPlayer.id, parsed.occurredAt);
  }

  const inserted = await insertPlayerEvent(env, syncContext, playerProfileId, lineNumber, parsed);
  if (!inserted) return result;

  result.eventsCreated = 1;
  result.playerEventsCreated = 1;

  if (parsed.eventType === "player_connected") result.joinsCreated = 1;
  if (parsed.eventType === "player_disconnected") result.disconnectsCreated = 1;

  if (parsed.eventType === "player_killed_environment" || parsed.eventType === "player_suicide") {
    const victimProfileId = eventPlayer.name
      ? await upsertPlayerProfile(env, syncContext, eventPlayer.name, eventPlayer.id, parsed.occurredAt)
      : playerProfileId;
    await updateProfilesForDeath(env, {
      killerProfileId: null,
      victimProfileId,
      killerGetsKill: false,
      suicide: parsed.eventType === "player_suicide",
      distance: null,
    });
    markDeathCounted(deathContext.recentDeathLines, parsed, lineNumber);
    result.deathsCreated = 1;
  }

  if (parsed.eventType === "player_died_stats") {
    const deathAlreadyCounted = wasDeathRecentlyCounted(deathContext.recentDeathLines, parsed, lineNumber);
    if (!deathAlreadyCounted) {
      await updateProfilesForDeath(env, {
        killerProfileId: null,
        victimProfileId: playerProfileId,
        killerGetsKill: false,
        suicide: false,
        distance: null,
      });
      markDeathCounted(deathContext.recentDeathLines, parsed, lineNumber);
      result.deathsCreated = 1;
    }
  }

  return result;
}

async function backfillMissingCreditedKills(
  env: Env,
  context: AdmSyncContext,
  parsedLines: ParsedAdmEvent[],
  processedLineCount: number,
  recentDeathLines: Map<string, number>,
) {
  const result = {
    eventsCreated: 0,
    killEventsCreated: 0,
    killsCreated: 0,
    deathsCreated: 0,
    duplicatesSkipped: 0,
    lastEventAt: null as string | null,
  };
  const backfillLimit = Math.min(Math.max(0, processedLineCount), parsedLines.length);

  for (let index = 0; index < backfillLimit; index += 1) {
    const parsed = parsedLines[index];
    if (!parsed || !isCreditedKillEvent(parsed)) continue;

    const lineNumber = index + 1;
    const eventResult = await persistParsedEvent(env, context, lineNumber, parsed, { recentDeathLines });
    if (eventResult.killsCreated > 0) {
      result.eventsCreated += eventResult.eventsCreated;
      result.killEventsCreated += eventResult.killEventsCreated;
      result.killsCreated += eventResult.killsCreated;
      result.deathsCreated += eventResult.deathsCreated;
      result.lastEventAt = parsed.occurredAt ?? result.lastEventAt;
    } else {
      result.duplicatesSkipped += 1;
    }
  }

  return result;
}

async function insertPlayerEvent(
  env: Env,
  context: AdmSyncContext,
  playerProfileId: string | null,
  lineNumber: number,
  parsed: ParsedAdmEvent,
) {
  const admFile = context.admFileName;
  assertAdmWriteScope(context, {
    linkedServerId: context.linkedServerId,
    sourceServiceId: context.nitradoServiceId,
    sourceAdmFile: admFile,
  }, "player_events");
  const db = requireDb(env);
  if (await hasExistingPlayerEventBySourceLine(env, context, lineNumber)) return false;
  const id = await stableSyncId("player-event", context.linkedServerId, admFile, lineNumber, parsed.eventType);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO player_events (
        id, linked_server_id, source_service_id, source_sync_run_id, player_profile_id,
        player_name, player_id, event_type, position_x, position_y, position_z,
        adm_file, source_adm_file, line_number, source_line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      context.linkedServerId,
      context.nitradoServiceId,
      context.syncRunId ?? null,
      playerProfileId,
      parsed.playerName,
      parsed.playerId,
      parsed.eventType,
      parsed.position?.x ?? null,
      parsed.position?.y ?? null,
      parsed.position?.z ?? null,
      admFile,
      admFile,
      lineNumber,
      lineNumber,
      parsed.occurredAt,
      parsed.rawLine,
    )
    .run();
  return didMutate(result);
}

async function hasExistingPlayerEventBySourceLine(env: Env, context: AdmSyncContext, lineNumber: number) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT id
       FROM player_events
       WHERE linked_server_id = ?
         AND COALESCE(source_service_id, ?) = ?
         AND COALESCE(source_adm_file, adm_file, '') = COALESCE(?, '')
         AND COALESCE(source_line_number, line_number) = ?
       LIMIT 1`,
    )
    .bind(
      context.linkedServerId,
      context.nitradoServiceId,
      context.nitradoServiceId,
      context.admFileName,
      lineNumber,
    )
    .first<{ id: string }>();
  return Boolean(row?.id);
}

async function insertBuildEvent(
  env: Env,
  context: AdmSyncContext,
  lineNumber: number,
  parsed: ParsedAdmEvent,
) {
  const build = classifyParsedBuildEvent(parsed);
  if (!build) return false;
  const admFile = context.admFileName ?? "unknown-adm";
  assertAdmWriteScope(context, {
    linkedServerId: context.linkedServerId,
    sourceServiceId: context.nitradoServiceId,
    sourceAdmFile: admFile,
  }, "build_events");
  const db = requireDb(env);
  const id = await stableSyncId("build-event", context.linkedServerId, admFile, lineNumber);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO build_events (
        id, linked_server_id, nitrado_service_id, player_id, player_name, event_type,
        build_part, target_object, tool, placed_object, placed_class, pos_x, pos_y, pos_z,
        source_adm_file, source_line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      context.linkedServerId,
      context.nitradoServiceId,
      parsed.playerId,
      parsed.playerName,
      build.eventType,
      build.buildPart,
      build.targetObject,
      build.tool,
      build.placedObject,
      build.placedClass,
      parsed.position?.x ?? null,
      parsed.position?.y ?? null,
      parsed.position?.z ?? null,
      admFile,
      lineNumber,
      parsed.occurredAt ?? new Date().toISOString(),
      parsed.rawLine,
    )
    .run();
  return didMutate(result);
}

async function insertKillEvent(
  env: Env,
  context: AdmSyncContext,
  killerProfileId: string | null,
  victimProfileId: string | null,
  lineNumber: number,
  parsed: ParsedAdmEvent,
) {
  const admFile = context.admFileName;
  assertAdmWriteScope(context, {
    linkedServerId: context.linkedServerId,
    sourceServiceId: context.nitradoServiceId,
    sourceAdmFile: admFile,
  }, "kill_events");
  const db = requireDb(env);
  if (await hasExistingKillEventByFallback(env, context, parsed)) return false;
  const id = await stableSyncId("kill-event", context.linkedServerId, admFile, lineNumber);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO kill_events (
        id, linked_server_id, source_service_id, source_sync_run_id, killer_profile_id,
        victim_profile_id, killer_name, victim_name, killer_id, victim_id, weapon,
        distance, position_x, position_y, position_z, adm_file, source_adm_file,
        line_number, source_line_number, occurred_at, raw_line, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      id,
      context.linkedServerId,
      context.nitradoServiceId,
      context.syncRunId ?? null,
      killerProfileId,
      victimProfileId,
      parsed.killerName ?? parsed.playerName,
      parsed.victimName,
      parsed.killerId ?? parsed.playerId,
      parsed.victimId,
      parsed.weapon,
      parsed.distance,
      parsed.killerPosition?.x ?? parsed.position?.x ?? null,
      parsed.killerPosition?.y ?? parsed.position?.y ?? null,
      parsed.killerPosition?.z ?? parsed.position?.z ?? null,
      admFile,
      admFile,
      lineNumber,
      lineNumber,
      parsed.occurredAt,
      parsed.rawLine,
    )
    .run();
  return didMutate(result);
}

async function hasExistingKillEventByFallback(env: Env, context: AdmSyncContext, parsed: ParsedAdmEvent) {
  const killer = parsed.killerId ?? parsed.killerName ?? parsed.playerId ?? parsed.playerName ?? "";
  const victim = parsed.victimId ?? parsed.victimName ?? "";
  if (!killer || !victim) return false;

  const db = requireDb(env);
  const distance = parsed.distance;
  const row = await db
    .prepare(
      `SELECT id
       FROM kill_events
       WHERE linked_server_id = ?
         AND COALESCE(source_service_id, ?) = ?
         AND COALESCE(occurred_at, '') = COALESCE(?, '')
         AND COALESCE(killer_id, killer_name, '') = ?
         AND COALESCE(victim_id, victim_name, '') = ?
         AND COALESCE(weapon, '') = COALESCE(?, '')
         AND (
           (? IS NULL AND distance IS NULL)
           OR ABS(COALESCE(distance, -9999999) - COALESCE(?, -9999999)) < 0.0001
         )
       LIMIT 1`,
    )
    .bind(
      context.linkedServerId,
      context.nitradoServiceId,
      context.nitradoServiceId,
      parsed.occurredAt,
      killer,
      victim,
      parsed.weapon,
      distance,
      distance,
    )
    .first<{ id: string }>();

  return Boolean(row?.id);
}

async function upsertPlayerProfile(
  env: Env,
  context: AdmSyncContext,
  playerName: string,
  playerId: string | null,
  lastSeenAt: string | null,
) {
  assertAdmWriteScope(context, {
    linkedServerId: context.linkedServerId,
    sourceServiceId: context.nitradoServiceId,
  }, "player_profiles");
  const db = requireDb(env);
  const existing = playerId
    ? await db
      .prepare("SELECT id FROM player_profiles WHERE linked_server_id = ? AND player_id = ? LIMIT 1")
      .bind(context.linkedServerId, playerId)
      .first<{ id: string }>()
    : await db
      .prepare("SELECT id FROM player_profiles WHERE linked_server_id = ? AND lower(player_name) = lower(?) LIMIT 1")
      .bind(context.linkedServerId, playerName)
      .first<{ id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          player_name = ?,
          player_id = COALESCE(?, player_id),
          source_service_id = COALESCE(source_service_id, ?),
          last_seen_at = COALESCE(?, last_seen_at),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(playerName, playerId, context.nitradoServiceId, lastSeenAt, existing.id)
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO player_profiles (
        id, linked_server_id, source_service_id, player_name, player_id, last_seen_at, first_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(id, context.linkedServerId, context.nitradoServiceId, playerName, playerId, lastSeenAt)
    .run();
  return id;
}

async function updateProfilesForDeath(
  env: Env,
  values: {
    killerProfileId: string | null;
    victimProfileId: string | null;
    killerGetsKill: boolean;
    suicide: boolean;
    distance: number | null;
  },
) {
  const db = requireDb(env);
  if (values.killerProfileId && values.killerGetsKill) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          kills = kills + 1,
          longest_kill_distance = MAX(longest_kill_distance, ?),
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(values.distance ?? 0, values.killerProfileId)
      .run();
  }
  if (values.victimProfileId) {
    await db
      .prepare(
        `UPDATE player_profiles SET
          deaths = deaths + 1,
          suicides = suicides + ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(values.suicide ? 1 : 0, values.victimProfileId)
      .run();
  }
}

async function upsertServerStats(
  env: Env,
  linkedServerId: string,
  increments: {
    sourceServiceId: string;
    kills: number;
    deaths: number;
    joins: number;
    disconnects: number;
    uniquePlayers: number;
    lastEventAt: string | null;
  },
) {
  const context = {
    linkedServerId,
    nitradoServiceId: increments.sourceServiceId,
    serverName: linkedServerId,
    admFileName: null,
  };
  assertAdmWriteScope(context, {
    linkedServerId,
    sourceServiceId: increments.sourceServiceId,
  }, "server_stats");
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO server_stats (
        id, linked_server_id, source_service_id, total_kills, total_deaths, total_joins, total_disconnects,
        unique_players, last_event_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        source_service_id = COALESCE(excluded.source_service_id, server_stats.source_service_id),
        total_kills = total_kills + excluded.total_kills,
        total_deaths = total_deaths + excluded.total_deaths,
        total_joins = total_joins + excluded.total_joins,
        total_disconnects = total_disconnects + excluded.total_disconnects,
        unique_players = excluded.unique_players,
        last_event_at = COALESCE(excluded.last_event_at, server_stats.last_event_at),
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      increments.sourceServiceId,
      increments.kills,
      increments.deaths,
      increments.joins,
      increments.disconnects,
      increments.uniquePlayers,
      increments.lastEventAt,
    )
    .run();
}

async function countUniquePlayers(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM player_profiles WHERE linked_server_id = ?")
    .bind(linkedServerId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function getNitradoTokenForLinkedServer(env: Env, linkedServer: SyncLinkedServer) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ? AND linked_server_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(linkedServer.user_id, linkedServer.id)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();

  if (!row) throw new Error("No Nitrado token found for this linked server");
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

async function countRemainingSyncRows(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const [raw, playerEvents, killEvents, buildEvents, profiles] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM adm_raw_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM build_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_profiles WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
  ]);
  return (
    numberOrZero(raw?.count) +
    numberOrZero(playerEvents?.count) +
    numberOrZero(killEvents?.count) +
    numberOrZero(buildEvents?.count) +
    numberOrZero(profiles?.count)
  );
}

async function rebuildServerStats(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const [server, kills, deathsFromKills, deathsFromPlayerEvents, joins, disconnects, uniquePlayers, lastEvent] = await Promise.all([
    db.prepare("SELECT nitrado_service_id FROM linked_servers WHERE id = ? LIMIT 1").bind(linkedServerId).first<{ nitrado_service_id: string | null }>(),
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ? AND victim_name IS NOT NULL").bind(linkedServerId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM player_events
         WHERE linked_server_id = ?
           AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')`,
      )
      .bind(linkedServerId)
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ? AND event_type = 'player_connected'").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_events WHERE linked_server_id = ? AND event_type = 'player_disconnected'").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM player_profiles WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT MAX(COALESCE(occurred_at, created_at)) AS last_event_at
         FROM (
           SELECT occurred_at, created_at FROM player_events WHERE linked_server_id = ?
           UNION ALL
           SELECT occurred_at, created_at FROM kill_events WHERE linked_server_id = ?
           UNION ALL
           SELECT occurred_at, created_at FROM build_events WHERE linked_server_id = ?
         )`,
      )
      .bind(linkedServerId, linkedServerId, linkedServerId)
      .first<{ last_event_at: string | null }>(),
  ]);

  await db
    .prepare(
      `INSERT INTO server_stats (
        id, linked_server_id, source_service_id, total_kills, total_deaths, total_joins, total_disconnects,
        unique_players, last_event_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        source_service_id = COALESCE(excluded.source_service_id, server_stats.source_service_id),
        total_kills = excluded.total_kills,
        total_deaths = excluded.total_deaths,
        total_joins = excluded.total_joins,
        total_disconnects = excluded.total_disconnects,
        unique_players = excluded.unique_players,
        last_event_at = excluded.last_event_at,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      crypto.randomUUID(),
      linkedServerId,
      server?.nitrado_service_id ?? null,
      numberOrZero(kills?.count),
      numberOrZero(deathsFromKills?.count) + numberOrZero(deathsFromPlayerEvents?.count),
      numberOrZero(joins?.count),
      numberOrZero(disconnects?.count),
      numberOrZero(uniquePlayers?.count),
      lastEvent?.last_event_at ?? null,
    )
    .run();
}

async function getAdmImportTotals(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const [kills, deathsFromKills, deathsFromPlayerEvents, longestKill] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM kill_events WHERE linked_server_id = ? AND victim_name IS NOT NULL").bind(linkedServerId).first<{ count: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM player_events
         WHERE linked_server_id = ?
           AND event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats')`,
      )
      .bind(linkedServerId)
      .first<{ count: number }>(),
    db.prepare("SELECT MAX(COALESCE(distance, 0)) AS distance FROM kill_events WHERE linked_server_id = ?").bind(linkedServerId).first<{ distance: number | null }>(),
  ]);
  return {
    totalKills: numberOrZero(kills?.count),
    totalDeaths: numberOrZero(deathsFromKills?.count) + numberOrZero(deathsFromPlayerEvents?.count),
    longestKillDistance: numberOrZero(longestKill?.distance),
  };
}

async function updateLastAdmImportReport(env: Env, linkedServerId: string, patch: Partial<Pick<AdmDatabaseImportReport, "publicCacheUpdated" | "discordQueuesCreated" | "cacheRefreshStatus" | "discordQueueStatus">>) {
  const db = requireDb(env);
  const row = await db
    .prepare("SELECT last_import_report_json FROM adm_sync_state WHERE linked_server_id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<{ last_import_report_json: string | null }>();
  if (!row?.last_import_report_json) return;
  try {
    const current = JSON.parse(row.last_import_report_json) as AdmDatabaseImportReport;
    await db
      .prepare("UPDATE adm_sync_state SET last_import_report_json = ?, updated_at = CURRENT_TIMESTAMP WHERE linked_server_id = ?")
      .bind(JSON.stringify({ ...current, ...patch }), linkedServerId)
      .run();
  } catch {
    return;
  }
}

export async function recordSyncRun(
  env: Env,
  values: {
    id?: string;
    linkedServerId: string | null;
    sourceServiceId?: string | null;
    triggerType: "manual" | "scheduled";
    status: string;
    message: string | null;
    linesRead: number;
    linesProcessed: number;
    eventsCreated: number;
    killsCreated: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  },
) {
  await ensureAdmSyncSchema(env);
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO sync_runs (
        id, linked_server_id, source_service_id, trigger_type, status, message, lines_read, lines_processed,
        events_created, kills_created, started_at, finished_at, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      values.id ?? crypto.randomUUID(),
      values.linkedServerId,
      values.sourceServiceId ?? null,
      values.triggerType,
      values.status,
      values.message,
      values.linesRead,
      values.linesProcessed,
      values.eventsCreated,
      values.killsCreated,
      values.startedAt,
      values.finishedAt,
      values.durationMs,
    )
    .run();
}

async function getRecentSyncRuns(env: Env, linkedServerId: string, limit: number) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT id, trigger_type, status, message, lines_read, lines_processed, events_created,
              kills_created, started_at, finished_at, duration_ms, created_at
       FROM sync_runs
       WHERE linked_server_id = ?
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT ?`,
    )
    .bind(linkedServerId, limit)
    .all<AdmSyncRunSummary>();

  return (result.results ?? []).map(mapSyncRunSummary);
}

async function getLatestSyncRunByTrigger(env: Env, linkedServerId: string, triggerType: "manual" | "scheduled") {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT id, trigger_type, status, message, lines_read, lines_processed, events_created,
              kills_created, started_at, finished_at, duration_ms, created_at
       FROM sync_runs
       WHERE linked_server_id = ? AND trigger_type = ?
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT 1`,
    )
    .bind(linkedServerId, triggerType)
    .first<AdmSyncRunSummary>();

  return row ? mapSyncRunSummary(row) : null;
}

async function getLatestSuccessfulSyncRun(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT id, trigger_type, status, message, lines_read, lines_processed, events_created,
              kills_created, started_at, finished_at, duration_ms, created_at
       FROM sync_runs
       WHERE linked_server_id = ?
         AND lower(status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<AdmSyncRunSummary>();

  return row ? mapSyncRunSummary(row) : null;
}

function mapSyncRunSummary(row: AdmSyncRunSummary): AdmSyncRunSummary {
  return {
    id: row.id,
    trigger_type: row.trigger_type,
    status: row.status,
    message: row.message,
    lines_read: numberOrZero(row.lines_read),
    lines_processed: numberOrZero(row.lines_processed),
    events_created: numberOrZero(row.events_created),
    kills_created: numberOrZero(row.kills_created),
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms === null || row.duration_ms === undefined ? null : numberOrZero(row.duration_ms),
    created_at: row.created_at,
  };
}

function getReadableAdmLines(samplePreview: string | null) {
  if (!samplePreview) return [];
  return samplePreview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getReadableAdmLinesForLinkedServer(
  env: Env,
  linkedServer: SyncLinkedServer,
  options: { isMock?: boolean; readMode?: "sample" | "full"; preferredAdmFileName?: string | null; preferredAdmPath?: string | null } = {},
): Promise<ReadableAdmLinesResult> {
  const isMock = options.isMock ?? isMockNitrado(env.MOCK_NITRADO);
  if (isMock) {
    const diagnostics = mockNitradoLogAccessDiagnostics(linkedServer.nitrado_service_id ?? "mock-service");
    return {
      lines: mockAdmLines(),
      newestAdmFileName: diagnostics.newestAdmFileName,
      latestAdmPath: "dayzps/config/DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
      readableRouteUsed: diagnostics.readable.routeRecommendation,
      diagnostics,
      message: "Mock ADM lines loaded through parser sync path",
    };
  }

  if (!linkedServer.nitrado_service_id) {
    return {
      lines: [],
      newestAdmFileName: null,
      latestAdmPath: linkedServer.adm_path,
      readableRouteUsed: null,
      diagnostics: null,
      message: "No Nitrado token or service ID is available for ADM log reading.",
    };
  }

  const token = await getNitradoTokenForLinkedServer(env, linkedServer);
  const readable = await fetchReadableNitradoAdmLines(token, linkedServer.nitrado_service_id, {
    mode: options.readMode ?? "sample",
    preferredAdmFileName: options.preferredAdmFileName ?? undefined,
    preferredAdmPath: options.preferredAdmPath ?? linkedServer.adm_path,
  });
  if (readable.diagnostics.readable.found && !readable.lines.length) {
    throw new Error("Diagnostics could read ADM lines, but sync helper failed to process them.");
  }

  if (readable.lines.length) {
    return {
      lines: readable.lines,
      newestAdmFileName: readable.diagnostics.newestAdmFileName,
      latestAdmPath: linkedServer.adm_path,
      readableRouteUsed: readable.diagnostics.readable.routeRecommendation,
      diagnostics: readable.diagnostics,
      message: `ADM lines readable via ${readable.diagnostics.readable.sourceLabel ?? "Nitrado diagnostics"}`,
    };
  }

  return {
    lines: [],
    newestAdmFileName: readable.diagnostics.newestAdmFileName,
    latestAdmPath: linkedServer.adm_path,
    readableRouteUsed: readable.diagnostics.readable.routeRecommendation,
    diagnostics: readable.diagnostics,
    message: readable.diagnostics.readable.message,
  };
}

async function getReadableAdmFilesForLinkedServer(
  env: Env,
  linkedServer: SyncLinkedServer,
  options: {
    isMock?: boolean;
    readMode?: "sample" | "full";
    previousLatestAdmFileName?: string | null;
    preferredAdmPath?: string | null;
    maxFiles?: number;
  } = {},
): Promise<{ files: ReadableAdmFileForSync[]; candidates: DiscoveredAdmFileForSync[]; filesFound: number; newestAdmFileName: string | null; apiStatus: string; message: string }> {
  const isMock = options.isMock ?? isMockNitrado(env.MOCK_NITRADO);
  if (isMock) {
    const diagnostics = mockNitradoLogAccessDiagnostics(linkedServer.nitrado_service_id ?? "mock-service");
    return {
      files: [{
        name: diagnostics.newestAdmFileName ?? "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
        path: "dayzps/config/DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
        lines: mockAdmLines(),
        readableRouteUsed: diagnostics.readable.routeRecommendation,
      }],
      candidates: [{
        name: diagnostics.newestAdmFileName ?? "DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
        path: "dayzps/config/DAYZSERVER_PS4_X64_2026-05-14_11-29-09.ADM",
        timestamp: null,
      }],
      filesFound: 1,
      newestAdmFileName: diagnostics.newestAdmFileName,
      apiStatus: "OK",
      message: "Mock ADM file loaded through parser sync path",
    };
  }

  if (!linkedServer.nitrado_service_id) {
    return {
      files: [],
      candidates: [],
      filesFound: 0,
      newestAdmFileName: null,
      apiStatus: "error",
      message: "No Nitrado token or service ID is available for ADM log reading.",
    };
  }

  const token = await getNitradoTokenForLinkedServer(env, linkedServer);
  const batch = await fetchReadableNitradoAdmFiles(token, linkedServer.nitrado_service_id, {
    mode: options.readMode ?? "sample",
    previousLatestAdmFileName: options.previousLatestAdmFileName,
    preferredAdmPath: options.preferredAdmPath ?? linkedServer.adm_path,
    maxFiles: options.maxFiles,
  });

  return {
    files: batch.files.map(mapReadableAdmFileForSync),
    candidates: batch.candidates.map(mapDiscoveredAdmFileForSync),
    filesFound: batch.filesFound,
    newestAdmFileName: batch.newestAdmFileName,
    apiStatus: batch.apiStatus,
    message: batch.files.length
      ? `Readable ADM files discovered: ${batch.files.map((file) => file.name).join(", ")}`
      : "ADM file list was discovered, but no readable ADM file content was returned.",
  };
}

function mapReadableAdmFileForSync(file: NitradoReadableAdmFile): ReadableAdmFileForSync {
  return {
    name: file.name,
    path: file.path,
    lines: file.lines,
    readableRouteUsed: file.readableRouteUsed,
  };
}

function mapDiscoveredAdmFileForSync(file: NitradoDiscoveredAdmFile): DiscoveredAdmFileForSync {
  return {
    name: file.name,
    path: file.path,
    timestamp: file.timestamp,
  };
}

function mockAdmLines() {
  return [
    "AdminLog started on 2026-05-14 at 13:45:00",
    "13:45:05 | Player \"MockSurvivor\" (id=mock-player-1) is connecting",
    "13:45:10 | Player \"MockSurvivor\" (id=mock-player-1 pos=<123.4, 456.7, 89.0>) is connected",
    "13:45:12 | Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 490.0, 92.0>) is connected",
    "13:45:35 | Player \"MockSurvivor\" (id=mock-player-1 pos=<124.0, 457.0, 89.1>) placed Fireplace",
    "13:46:09 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>)[HP: 0] hit by Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 490.0, 92.0>) into Head(0) for 30.5 damage (Bullet_556x45) with M4A1 from 72.5 meters",
    "13:46:10 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>) killed by Player \"MockBandit\" (id=mock-player-2 pos=<140.0, 490.0, 92.0>) with M4A1 from 72.5 meters",
    "13:46:11 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>) died. Stats> Water: 582.795 Energy: 582.795 Bleed sources: 0",
    "13:47:00 | Player \"MockRunner\" (id=mock-player-3 pos=<150.0, 500.0, 94.0>) is connected",
    "13:47:40 | Player \"MockRunner\" (id=mock-player-3 pos=<151.0, 501.0, 94.2>) committed suicide",
    "13:48:00 | Player \"MockBandit\" (id=mock-player-2 pos=<141.0, 491.0, 92.0>) has been disconnected",
    "13:48:02 | ##### PlayerList log: 2 players",
    "13:48:02 | #####",
    "13:48:02 | Player \"MockBandit\" (id=mock-player-2 pos=<141.0, 491.0, 92.0>)",
    "13:48:02 | Player \"MockSurvivor\" (DEAD) (id=mock-player-1 pos=<130.0, 460.0, 89.1>)",
  ];
}

function fileNameFromPath(path: string | null) {
  return path ? path.split("/").filter(Boolean).at(-1) ?? null : null;
}

async function stableSyncId(prefix: string, linkedServerId: string, admFile: string | null, lineNumber: number, suffix = "") {
  const input = `${prefix}:${linkedServerId}:${admFile ?? "unknown-adm"}:${lineNumber}:${suffix}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const hash = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${hash.slice(0, 48)}`;
}

function didMutate(result: { meta?: { changes?: number } }) {
  return Number(result.meta?.changes ?? 0) > 0;
}

function extractAdmDateFromFile(fileName: string | null) {
  const match = fileName ? /(\d{4}-\d{2}-\d{2})/.exec(fileName) : null;
  return match?.[1] ?? null;
}

function extractAdmTimestampScore(fileName: string | null | undefined) {
  const match = fileName?.match(/(\d{4})[-_](\d{2})[-_](\d{2})[_-](\d{2})[-_](\d{2})[-_](\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function getPlayerForPlayerEvent(parsed: ParsedAdmEvent) {
  if (parsed.playerName) return { name: parsed.playerName, id: parsed.playerId };
  if (parsed.victimName) return { name: parsed.victimName, id: parsed.victimId };
  if (parsed.attackerName) return { name: parsed.attackerName, id: parsed.attackerId };
  return { name: null, id: null };
}

function getDeathKey(parsed: ParsedAdmEvent) {
  const id = parsed.victimId ?? parsed.playerId;
  if (id) return `id:${id}`;
  const name = parsed.victimName ?? parsed.playerName;
  return name ? `name:${name.toLowerCase()}` : null;
}

function markDeathCounted(recentDeathLines: Map<string, number>, parsed: ParsedAdmEvent, lineNumber: number) {
  const key = getDeathKey(parsed);
  if (key) recentDeathLines.set(key, lineNumber);
}

function wasDeathRecentlyCounted(recentDeathLines: Map<string, number>, parsed: ParsedAdmEvent, lineNumber: number) {
  const key = getDeathKey(parsed);
  if (!key) return false;
  const previousLine = recentDeathLines.get(key);
  return typeof previousLine === "number" && lineNumber - previousLine <= 5;
}

function isDeathCountingEvent(parsed: ParsedAdmEvent) {
  return (
    isCreditedKillEvent(parsed) ||
    parsed.eventType === "player_killed_environment" ||
    parsed.eventType === "player_suicide" ||
    parsed.eventType === "player_died_stats"
  );
}

function isCreditedKillEvent(parsed: ParsedAdmEvent) {
  return parsed.eventType === "player_killed" && parsed.isCreditedKill;
}

function emptyPersistResult() {
  return {
    eventsCreated: 0,
    playerEventsCreated: 0,
    killEventsCreated: 0,
    buildEventsCreated: 0,
    killsCreated: 0,
    joinsCreated: 0,
    disconnectsCreated: 0,
    deathsCreated: 0,
  };
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function nullablePositiveInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function parseAdmDatabaseImportReport(value: unknown): AdmDatabaseImportReport | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AdmDatabaseImportReport>;
    return {
      admFileName: typeof parsed.admFileName === "string" ? parsed.admFileName : null,
      cursorStart: numberOrZero(parsed.cursorStart),
      cursorEnd: numberOrZero(parsed.cursorEnd),
      rawKilledByLinesFound: numberOrZero(parsed.rawKilledByLinesFound),
      parsedPvpKills: numberOrZero(parsed.parsedPvpKills),
      skippedDeadHitLines: numberOrZero(parsed.skippedDeadHitLines),
      parsedSuicides: numberOrZero(parsed.parsedSuicides),
      parsedUncreditedDeaths: numberOrZero(parsed.parsedUncreditedDeaths),
      duplicateSkips: numberOrZero(parsed.duplicateSkips),
      pvpKillLineNumbers: Array.isArray(parsed.pvpKillLineNumbers) ? parsed.pvpKillLineNumbers.map(numberOrZero).filter((line) => line > 0) : [],
      attemptedDbWrites: numberOrZero(parsed.attemptedDbWrites),
      successfulDbWrites: numberOrZero(parsed.successfulDbWrites),
      writtenKills: numberOrZero(parsed.writtenKills),
      failedWrites: numberOrZero(parsed.failedWrites),
      cursorBefore: numberOrZero(parsed.cursorBefore),
      cursorAfter: numberOrZero(parsed.cursorAfter),
      cursorAdvanced: Boolean(parsed.cursorAdvanced),
      publicCacheUpdated: Boolean(parsed.publicCacheUpdated),
      discordQueuesCreated: numberOrZero(parsed.discordQueuesCreated),
      cacheRefreshStatus: parsed.cacheRefreshStatus === "updated" || parsed.cacheRefreshStatus === "failed" ? parsed.cacheRefreshStatus : "skipped",
      discordQueueStatus: parsed.discordQueueStatus === "queued" || parsed.discordQueueStatus === "failed" ? parsed.discordQueueStatus : "skipped",
      cursorValidationStatus: isAdmCursorValidationStatus(parsed.cursorValidationStatus) ? parsed.cursorValidationStatus : "legacy_no_hash",
      cursorValidationError: typeof parsed.cursorValidationError === "string" ? parsed.cursorValidationError : null,
      cursorRecoveryStrategy: typeof parsed.cursorRecoveryStrategy === "string" ? parsed.cursorRecoveryStrategy : null,
      cursorRecoveryReason: typeof parsed.cursorRecoveryReason === "string" ? parsed.cursorRecoveryReason : null,
      previousLineHash: typeof parsed.previousLineHash === "string" ? parsed.previousLineHash : null,
      currentLineHash: typeof parsed.currentLineHash === "string" ? parsed.currentLineHash : null,
      cursorLineChecked: parsed.cursorLineChecked === null || parsed.cursorLineChecked === undefined ? null : numberOrZero(parsed.cursorLineChecked),
      cursorHashMatched: typeof parsed.cursorHashMatched === "boolean" ? parsed.cursorHashMatched : null,
    };
  } catch {
    return null;
  }
}

function isAdmCursorValidationStatus(value: unknown): value is AdmCursorValidationStatus {
  return (
    value === "valid" ||
    value === "legacy_no_hash" ||
    value === "hash_mismatch" ||
    value === "line_out_of_range" ||
    value === "hash_found_repositioned" ||
    value === "safe_tail_reprocess" ||
    value === "new_file"
  );
}

function nullableBoolean(value: unknown) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function minutesSinceIso(value: string, nowMs = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > nowMs) return null;
  return Math.max(0, Math.round((nowMs - timestamp) / 60000));
}

function addMinutesToIso(value: string, minutes: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + Math.max(0, Math.round(minutes)) * 60000).toISOString();
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function clampPositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function safeSyncErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Scheduled sync failed";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/token=([^&\s]+)/gi, "token=[redacted]")
    .slice(0, 500);
}

function classifyNitradoExceptionStatus(error: unknown, latestAdmFile: string | null): AdmSyncStatusCode {
  const message = safeSyncErrorMessage(error).toLowerCase();
  if (/401|403|token|unauthori[sz]ed|forbidden|permission|expired|invalid/.test(message)) return "nitrado_auth_invalid";
  if (/429|rate limit|thrott/i.test(message)) return "nitrado_rate_limited";
  if (latestAdmFile) return "adm_file_unreadable";
  return "nitrado_down";
}

const ADM_SYNC_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS adm_sync_state (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL UNIQUE,
    latest_adm_file TEXT,
    latest_adm_path TEXT,
    last_processed_file TEXT,
    last_processed_line INTEGER DEFAULT 0,
    last_processed_offset INTEGER DEFAULT 0,
    last_sync_status TEXT DEFAULT 'not_started',
    last_sync_message TEXT,
    last_sync_at TEXT,
    last_lines_read INTEGER DEFAULT 0,
    last_lines_processed INTEGER DEFAULT 0,
    last_raw_events_stored INTEGER DEFAULT 0,
    last_player_events_stored INTEGER DEFAULT 0,
    last_kill_events_stored INTEGER DEFAULT 0,
    last_events_created INTEGER DEFAULT 0,
    last_kills_created INTEGER DEFAULT 0,
    last_unknown_lines INTEGER DEFAULT 0,
    last_duplicate_lines INTEGER DEFAULT 0,
    last_sync_duration_ms INTEGER,
    last_readable_route TEXT,
    last_raw_kill_lines_found INTEGER DEFAULT 0,
    last_parsed_kill_lines_found INTEGER DEFAULT 0,
    last_parser_skipped_lines INTEGER DEFAULT 0,
    last_unreadable_files_queued INTEGER DEFAULT 0,
    last_newest_unprocessed_adm_file TEXT,
    last_import_report_json TEXT,
    last_processed_adm_line_hash TEXT,
    last_processed_adm_line_text_preview TEXT,
    last_cursor_validation_status TEXT,
    last_cursor_validation_error TEXT,
    last_cursor_validation_at TEXT,
    cursor_recovery_strategy TEXT,
    cursor_recovery_reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS adm_sync_file_state (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    source_service_id TEXT NOT NULL,
    adm_file TEXT NOT NULL,
    adm_path TEXT,
    status TEXT NOT NULL DEFAULT 'discovered',
    first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_checked_at TEXT,
    last_readable_at TEXT,
    processed_at TEXT,
    line_count INTEGER DEFAULT 0,
    last_line_processed INTEGER DEFAULT 0,
    raw_kill_lines_found INTEGER DEFAULT 0,
    parsed_kill_lines_found INTEGER DEFAULT 0,
    inserted_kills INTEGER DEFAULT 0,
    parser_skipped_lines INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    ignored_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS adm_raw_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    adm_file TEXT,
    line_number INTEGER,
    raw_line TEXT NOT NULL,
    event_type TEXT,
    parsed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS player_profiles (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    player_id TEXT,
    discord_id TEXT,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    suicides INTEGER DEFAULT 0,
    longest_kill_distance REAL DEFAULT 0,
    last_seen_at TEXT,
    first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS player_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    player_profile_id TEXT,
    player_name TEXT,
    player_id TEXT,
    event_type TEXT NOT NULL,
    position_x REAL,
    position_y REAL,
    position_z REAL,
    adm_file TEXT,
    line_number INTEGER,
    occurred_at TEXT,
    raw_line TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS kill_events (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    killer_profile_id TEXT,
    victim_profile_id TEXT,
    killer_name TEXT,
    victim_name TEXT,
    killer_id TEXT,
    victim_id TEXT,
    weapon TEXT,
    distance REAL,
    position_x REAL,
    position_y REAL,
    position_z REAL,
    adm_file TEXT,
    line_number INTEGER,
    occurred_at TEXT,
    raw_line TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS server_stats (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL UNIQUE,
    total_kills INTEGER DEFAULT 0,
    total_deaths INTEGER DEFAULT 0,
    total_joins INTEGER DEFAULT 0,
    total_disconnects INTEGER DEFAULT 0,
    unique_players INTEGER DEFAULT 0,
    last_event_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT,
    trigger_type TEXT,
    status TEXT,
    message TEXT,
    lines_read INTEGER DEFAULT 0,
    lines_processed INTEGER DEFAULT 0,
    events_created INTEGER DEFAULT 0,
    kills_created INTEGER DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_adm_sync_state_linked_server_id ON adm_sync_state(linked_server_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_adm_sync_file_state_server_file ON adm_sync_file_state(linked_server_id, source_service_id, adm_file)",
  "CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_status ON adm_sync_file_state(status)",
  "CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_checked ON adm_sync_file_state(last_checked_at)",
  "CREATE INDEX IF NOT EXISTS idx_adm_raw_events_linked_server_id ON adm_raw_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_adm_raw_events_adm_file ON adm_raw_events(adm_file)",
  "CREATE INDEX IF NOT EXISTS idx_adm_raw_events_event_type ON adm_raw_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_linked_server_id ON player_profiles(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_player_name ON player_profiles(player_name)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_player_id ON player_profiles(player_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_events_linked_server_id ON player_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_events_event_type ON player_events(event_type)",
  "CREATE INDEX IF NOT EXISTS idx_player_events_occurred_at ON player_events(occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_linked_server_id ON kill_events(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_killer_name ON kill_events(killer_name)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_victim_name ON kill_events(victim_name)",
  "CREATE INDEX IF NOT EXISTS idx_kill_events_occurred_at ON kill_events(occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_stats_linked_server_id ON server_stats(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_linked_server_id ON sync_runs(linked_server_id)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_created_at ON sync_runs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_status ON sync_runs(status)",
];

const ADM_SYNC_SCOPE_INDEX_STATEMENTS = [
  `UPDATE adm_raw_events
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = adm_raw_events.linked_server_id)),
       source_adm_file = COALESCE(source_adm_file, adm_file),
       source_line_number = COALESCE(source_line_number, line_number)
   WHERE source_service_id IS NULL OR source_adm_file IS NULL OR source_line_number IS NULL`,
  `UPDATE player_events
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = player_events.linked_server_id)),
       source_adm_file = COALESCE(source_adm_file, adm_file),
       source_line_number = COALESCE(source_line_number, line_number)
   WHERE source_service_id IS NULL OR source_adm_file IS NULL OR source_line_number IS NULL`,
  `UPDATE kill_events
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = kill_events.linked_server_id)),
       source_adm_file = COALESCE(source_adm_file, adm_file),
       source_line_number = COALESCE(source_line_number, line_number)
   WHERE source_service_id IS NULL OR source_adm_file IS NULL OR source_line_number IS NULL`,
  `UPDATE player_profiles
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = player_profiles.linked_server_id))
   WHERE source_service_id IS NULL`,
  `UPDATE server_stats
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = server_stats.linked_server_id))
   WHERE source_service_id IS NULL`,
  `UPDATE adm_sync_state
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = adm_sync_state.linked_server_id))
   WHERE source_service_id IS NULL`,
  `UPDATE sync_runs
   SET source_service_id = COALESCE(source_service_id, (SELECT nitrado_service_id FROM linked_servers WHERE linked_servers.id = sync_runs.linked_server_id))
   WHERE source_service_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_kill_events_service_file_line
   ON kill_events(source_service_id, source_adm_file, source_line_number)
   WHERE source_service_id IS NOT NULL AND source_adm_file IS NOT NULL AND source_line_number IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_adm_raw_events_service_file_line
   ON adm_raw_events(source_service_id, source_adm_file, source_line_number)`,
  `CREATE INDEX IF NOT EXISTS idx_player_events_service_file_line
   ON player_events(source_service_id, source_adm_file, source_line_number)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_runs_source_service_id ON sync_runs(source_service_id)`,
];
