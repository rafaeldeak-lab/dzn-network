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
  latestAdmFileReadDiagnostic,
  mockAdmLogDetection,
  mockNitradoLogAccessDiagnostics,
  readAdmFileTextWithFallback,
  summarizeAdmFileReadOutcomes,
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
  isActiveSubscriptionStatus,
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
import { normalizePlanKey, type PlanKey } from "./plans";
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
  latest_adm_status: string | null;
  latest_adm_next_retry_at: string | null;
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
  consecutive_failed_adm_reads: number | null;
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
  parsedJoins: number;
  parsedDisconnects: number;
  parsedPlayerlistSnapshots: number;
  parsedHitLines: number;
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
  importSource?: string | null;
  importedAt?: string | null;
  importReportId?: string | null;
  parserWarnings?: string[];
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
  rawLines: number;
  rawEventsStored: number;
  playerEventsStored: number;
  killEventsStored: number;
  buildEventsStored: number;
  eventsCreated: number;
  killsCreated: number;
  deathsCreated: number;
  joinsCreated: number;
  disconnectsCreated: number;
  playerlistSnapshotsParsed: number;
  duplicateLines: number;
  publicCacheUpdated: boolean;
  discordQueuesCreated: number;
  importReportId: string;
  importedAt: string;
  parserWarnings: string[];
  totalKills: number;
  totalDeaths: number;
  longestKillDistance: number;
};

export type ManualAdmTextImportResult = {
  ok: true;
  filename: string;
  source: "manual_paste" | "manual_upload" | string;
  raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  written_kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  duplicate_skips: number;
  failed_writes: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  import_report_id: string;
  imported_at: string;
  parser_warnings: string[];
  total_kills: number;
  total_deaths: number;
  kill_previews: ManualAdmKillPreview[];
  import_report: AdmDatabaseImportReport;
};

export type ManualAdmKillPreview = {
  line_number: number;
  occurred_at: string | null;
  victim_name: string | null;
  killer_name: string | null;
  weapon: string | null;
  distance: number | null;
  event_type: "pvp_kill";
};

export type ManualAdmParsePreviewResult = {
  ok: true;
  filename: string;
  source: "manual_preview";
  raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  skipped_dead_hit_lines: number;
  parser_warnings: string[];
  kill_previews: ManualAdmKillPreview[];
};

export type ManualAdmBulkFileInput = {
  filename: string;
  admText: string;
};

export type ManualAdmBulkFileResult = {
  ok: boolean;
  filename: string;
  source: string;
  status: "previewed" | "imported" | "completed_with_warnings" | "duplicate_only" | "completed_duplicate_only" | "processing" | "failed" | "failed_retryable" | "cancelled";
  job_id?: string | null;
  job_status?: string | null;
  chunks_processed?: number;
  total_chunks?: number;
  raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  written_kills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  duplicate_skips: number;
  failed_writes: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  parser_warnings: string[];
  kill_previews: ManualAdmKillPreview[];
  import_report_id: string | null;
  imported_at: string | null;
  error_code?: string;
  message?: string;
  details?: unknown;
};

export type AdmImportJobProgressResult = {
  ok: true;
  job_id: string;
  filename: string;
  source: string;
  status: "queued" | "processing" | "parsing" | "writing" | "rebuilding" | "completed" | "completed_with_warnings" | "failed" | "failed_retryable" | "cancelled";
  total_lines: number;
  current_line: number;
  chunk_size: number;
  total_chunks: number;
  chunks_processed: number;
  display_current_chunk: number;
  chunk_count_mismatch?: boolean;
  already_processed?: boolean;
  import_hit_lines?: boolean;
  last_chunk_index?: number | null;
  failed_chunk_index?: number | null;
  progress: number;
  parsed_kills: number;
  written_kills: number;
  duplicate_skips: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  warnings: string[];
  file_result: ManualAdmBulkFileResult | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
};

export type ScheduledAdmImportJobResult = {
  ok: boolean;
  status: string;
  message: string;
  job: AdmImportJobProgressResult | null;
  duplicateExistingJob: boolean;
  latestAdmFile: string | null;
  latestAdmTimestamp?: string | null;
  newestAvailableAdmFile?: string | null;
  newestAvailableAdmTimestamp?: string | null;
  newestReadableAdmFile?: string | null;
  newestReadableAdmTimestamp?: string | null;
};

export type AdmBackfillPlannerFile = {
  name: string;
  path?: string | null;
  timestamp?: number | null;
  readable?: boolean;
  readError?: string | null;
};

export type AdmBackfillPlannerExistingJob = {
  filename: string;
  status: string;
  source?: string | null;
};

export type AdmBackfillCandidatePlan = {
  windowFiles: string[];
  missingFiles: string[];
  createFiles: string[];
  queuedFiles: string[];
  unreadableFiles: Array<{ filename: string; error: string | null }>;
  skippedAlreadyImported: string[];
  oldestMissingFile: string | null;
  newestMissingFile: string | null;
  activeJobFilename: string | null;
  nextAction: string;
};

export type AdmBackfillStatus = {
  missing_files_detected: number;
  queued_files: string[];
  active_file: string | null;
  active_job: AdmImportJobProgressResult | null;
  completed_files_today: number;
  skipped_already_imported: number;
  oldest_missing_file: string | null;
  newest_missing_file: string | null;
  unreadable_files: string[];
  next_action: string;
  last_planned_at: string | null;
};

export type AdmBackfillPlanResult = {
  ok: boolean;
  status: string;
  message: string;
  plan_key: PlanKey;
  files_found: number;
  window_files: string[];
  missing_files: string[];
  queued_files: string[];
  created_jobs: AdmImportJobProgressResult[];
  active_job: AdmImportJobProgressResult | null;
  completed_files: string[];
  skipped_already_imported: string[];
  unreadable_files: Array<{ filename: string; error: string | null }>;
  oldest_missing_file: string | null;
  newest_missing_file: string | null;
  newest_available_adm_file: string | null;
  newest_available_adm_timestamp: string | null;
  newest_readable_adm_file: string | null;
  newest_readable_adm_timestamp: string | null;
  next_action: string;
};

export type PendingAdmImportJobsResult = {
  processedJobs: number;
  completedJobs: number;
  chunksProcessed: number;
  failedJobs: number;
  results: AdmImportJobProgressResult[];
};

export type ManualAdmBulkImportResult = {
  ok: true;
  mode: "preview" | "import";
  source: string;
  files_uploaded: number;
  files_imported: number;
  failed_files: number;
  total_raw_lines: number;
  raw_kill_lines_found: number;
  parsed_kills: number;
  written_kills: number;
  duplicate_kills_skipped: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  deaths: number;
  suicides: number;
  hit_lines: number;
  raw_events_stored: number;
  player_events_stored: number;
  public_cache_updated: boolean;
  discord_jobs_queued: number;
  warnings: string[];
  errors: string[];
  files: ManualAdmBulkFileResult[];
};

export type ManualAdmImportHistoryItem = {
  id: string;
  filename: string | null;
  imported_at: string | null;
  source: string;
  status: string;
  raw_lines: number;
  parsed_kills: number;
  written_kills: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  duplicate_skips: number;
  failed_writes: number;
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
  | "processing_in_chunks"
  | "adm_import_job_queued"
  | "adm_backfill_queued"
  | "adm_backfill_caught_up"
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
  active_adm_import_job: AdmImportJobProgressResult | null;
  adm_backfill_status: AdmBackfillStatus;
  last_adm_import_report: AdmDatabaseImportReport | null;
  current_recovery_action: string;
  recent_sync_runs: AdmSyncRunSummary[];
  manual_import_history: ManualAdmImportHistoryItem[];
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

type ManualImportLinkedServer = SyncLinkedServer & {
  guild_id: string | null;
  plan_key: PlanKey;
  subscription_status: string | null;
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
      directPreferredFirst: true,
      maxListDirs: 4,
      maxListSearches: 2,
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
  if (["processing_in_chunks", "adm_import_job_queued", "adm_backfill_queued"].includes(normalized)) return "ADM Sync Active";
  if (normalized === "adm_backfill_caught_up") return "Healthy";
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
  if (["processing_in_chunks", "adm_import_job_queued", "adm_backfill_queued"].includes(normalized)) return "Processing ADM backfill in chunks. DZN will continue on the next cron tick.";
  if (normalized === "adm_backfill_caught_up") return "ADM backfill is caught up. DZN is waiting for the next Nitrado reset file.";
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
    "processing_in_chunks",
    "adm_import_job_queued",
    "adm_backfill_queued",
    "adm_backfill_caught_up",
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

export function buildAdmBackfillPlan(input: {
  files: AdmBackfillPlannerFile[];
  handledFilenames?: string[];
  existingJobs?: AdmBackfillPlannerExistingJob[];
  planKey?: PlanKey | string | null;
  nowMs?: number;
  windowHours?: number;
  maxWindowFiles?: number;
  maxJobsToCreate?: number;
}): AdmBackfillCandidatePlan {
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const plan = normalizePlanKey(input.planKey);
  const windowHours = Math.max(1, Math.min(168, Math.trunc(Number(input.windowHours ?? (plan === "partner" ? 168 : 24)))));
  const maxWindowFiles = Math.max(1, Math.min(48, Math.trunc(Number(input.maxWindowFiles ?? (plan === "partner" ? 24 : 10)))));
  const maxJobsToCreate = Math.max(0, Math.min(3, Math.trunc(Number(input.maxJobsToCreate ?? getAdmBackfillQueueLimit(input.planKey)))));
  const handled = new Set((input.handledFilenames ?? []).map(normalizeAdmFilenameKey).filter(Boolean));
  const existingJobs = input.existingJobs ?? [];
  const existingByName = new Map<string, AdmBackfillPlannerExistingJob>();
  for (const job of existingJobs) {
    const key = normalizeAdmFilenameKey(job.filename);
    if (!key) continue;
    const current = existingByName.get(key);
    if (!current || getBackfillJobPriority(job.status) < getBackfillJobPriority(current.status)) {
      existingByName.set(key, job);
    }
    if (isCompletedAdmImportJobStatus(String(job.status))) handled.add(key);
  }

  const filesByName = new Map<string, AdmBackfillPlannerFile>();
  for (const file of input.files) {
    const key = normalizeAdmFilenameKey(file.name);
    if (!key) continue;
    const existing = filesByName.get(key);
    const normalized = {
      ...file,
      timestamp: file.timestamp ?? extractAdmTimestampScore(file.name),
    };
    if (!existing || compareAdmFileNamesChronological(existing.name, normalized.name) <= 0) {
      filesByName.set(key, normalized);
    }
  }

  const sorted = [...filesByName.values()].sort((a, b) => {
    const aTimestamp = a.timestamp ?? extractAdmTimestampScore(a.name);
    const bTimestamp = b.timestamp ?? extractAdmTimestampScore(b.name);
    if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) return aTimestamp - bTimestamp;
    return compareAdmFileNamesChronological(a.name, b.name);
  });
  const cutoff = nowMs - windowHours * 60 * 60 * 1000;
  const recent = sorted.filter((file) => {
    const timestamp = file.timestamp ?? extractAdmTimestampScore(file.name);
    return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  const tail = sorted.slice(-maxWindowFiles);
  const windowByName = new Map<string, AdmBackfillPlannerFile>();
  for (const file of [...recent, ...tail]) {
    const key = normalizeAdmFilenameKey(file.name);
    if (key) windowByName.set(key, file);
  }
  const windowFiles = [...windowByName.values()].sort((a, b) => compareAdmFileNamesChronological(a.name, b.name));
  const activeJob = existingJobs
    .filter((job) => isActiveAdmImportJobStatus(String(job.status)))
    .sort((a, b) => compareAdmFileNamesChronological(a.filename, b.filename))[0] ?? null;

  const missingFiles: string[] = [];
  const queuedFiles: string[] = [];
  const unreadableFiles: Array<{ filename: string; error: string | null }> = [];
  const skippedAlreadyImported: string[] = [];
  const creatable: string[] = [];

  for (const file of windowFiles) {
    const key = normalizeAdmFilenameKey(file.name);
    if (!key) continue;
    const existingJob = existingByName.get(key);
    if (handled.has(key)) {
      skippedAlreadyImported.push(file.name);
      continue;
    }
    if (existingJob && isActiveAdmImportJobStatus(String(existingJob.status))) {
      missingFiles.push(file.name);
      queuedFiles.push(file.name);
      continue;
    }
    if (existingJob && isCompletedAdmImportJobStatus(String(existingJob.status))) {
      skippedAlreadyImported.push(file.name);
      continue;
    }
    missingFiles.push(file.name);
    if (!file.readable) {
      unreadableFiles.push({ filename: file.name, error: file.readError ?? null });
      continue;
    }
    creatable.push(file.name);
  }

  const createFiles = activeJob ? [] : creatable.slice(0, maxJobsToCreate);
  const allQueued = [...new Set([...queuedFiles, ...createFiles])];
  const nextAction = activeJob
    ? `Continue importing ${activeJob.filename} before starting the next backfill file.`
    : createFiles.length
      ? `Queue ${createFiles.length} missing ADM file${createFiles.length === 1 ? "" : "s"} for scheduled chunk import.`
      : unreadableFiles.length && missingFiles.length === unreadableFiles.length
        ? "Retry unreadable missing ADM files later; newer readable files will not be blocked."
        : missingFiles.length
          ? "Missing ADM files are already queued or waiting for retry."
          : "ADM backfill is caught up.";

  return {
    windowFiles: windowFiles.map((file) => file.name),
    missingFiles,
    createFiles,
    queuedFiles: allQueued,
    unreadableFiles,
    skippedAlreadyImported,
    oldestMissingFile: missingFiles[0] ?? null,
    newestMissingFile: missingFiles.at(-1) ?? null,
    activeJobFilename: activeJob?.filename ?? null,
    nextAction,
  };
}

function normalizeAdmFilenameKey(value: string | null | undefined) {
  return fileNameFromPath(value ?? null)?.trim().toLowerCase() ?? "";
}

function getBackfillJobPriority(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (isActiveAdmImportJobStatus(normalized)) return 0;
  if (isCompletedAdmImportJobStatus(normalized)) return 1;
  return 2;
}

function isActiveAdmImportJobStatus(status: string | null | undefined) {
  return ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(String(status ?? "").toLowerCase());
}

function getAdmBackfillQueueLimit(planKey: PlanKey | string | null | undefined) {
  return normalizePlanKey(planKey) === "partner" ? 3 : 1;
}

function getAdmBackfillReadLimit(planKey: PlanKey | string | null | undefined) {
  const plan = normalizePlanKey(planKey);
  if (plan === "partner") return 24;
  if (plan === "network" || plan === "pro") return 16;
  return 10;
}

const ADM_UNREADABLE_RETRY_LIMIT = 5;
const ADM_UNREADABLE_RETRY_AFTER_MS = 15 * 60 * 1000;
const DEFAULT_ADM_MAX_FILES_PER_INVOCATION = 1;
const DEFAULT_ADM_MAX_UNREADABLE_RETRIES_PER_INVOCATION = 1;
const DEFAULT_ADM_MAX_READ_ATTEMPTS_PER_FILE = 2;
const DEFAULT_ADM_MAX_TOKENIZED_ATTEMPTS_PER_FILE = 1;
const DEFAULT_ADM_MAX_CHUNKED_READ_CHUNKS = 8;
const DEFAULT_ADM_MAX_IMPORT_LINES_PER_INVOCATION = 300;
const DEFAULT_ADM_MAX_D1_WRITE_BATCHES_PER_INVOCATION = 10;
const DEFAULT_ADM_MAX_DIAGNOSTIC_ROWS_PER_INVOCATION = 10;
const MANUAL_ADM_UNREADABLE_RETRY_FILES_PER_RUN = 10;

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
    parsedJoins: pendingEvents.filter((event) => event.eventType === "player_connected").length,
    parsedDisconnects: pendingEvents.filter((event) => event.eventType === "player_disconnected").length,
    parsedPlayerlistSnapshots: pendingEvents.filter((event) => event.eventType === "playerlist_snapshot").length,
    parsedHitLines: pendingEvents.filter(isHitEvent).length,
    skippedDeadHitLines: pendingEvents.filter(isDeadHitNonKillEvent).length,
    parsedSuicides: pendingEvents.filter((event) => event.eventType === "player_suicide").length,
    parsedUncreditedDeaths: pendingEvents.filter((event) => event.eventType === "player_died_stats").length,
    duplicateSkips,
    pvpKillLineNumbers,
  };
}

function buildParserWarnings(report: AdmImportDebugReport) {
  const warnings: string[] = [];
  const missedKillLines = report.rawKilledByLinesFound - report.parsedPvpKills;
  if (missedKillLines > 0) {
    warnings.push(`${missedKillLines} raw killed-by line${missedKillLines === 1 ? "" : "s"} did not parse as PvP kills.`);
  }
  if (report.skippedDeadHitLines > 0) {
    warnings.push(`${report.skippedDeadHitLines} DEAD hit line${report.skippedDeadHitLines === 1 ? "" : "s"} skipped as non-kills.`);
  }
  return warnings;
}

function buildAdmImportSyncRunMessage(values: {
  source: string;
  filename: string | null;
  rawLines: number;
  parsedKills: number;
  writtenKills: number;
  joins: number;
  disconnects: number;
  playerlistSnapshots: number;
  duplicateSkips: number;
  failedWrites: number;
  importedAt: string;
}) {
  const type = values.source === SCHEDULED_ADM_IMPORT_SOURCE
    ? "scheduled_adm_import"
    : values.source === "manual_paste" || values.source === "manual_file_upload" || values.source === "manual_upload"
      ? "manual_adm_import"
      : "adm_import";
  return JSON.stringify({
    type,
    filename: values.filename,
    imported_at: values.importedAt,
    source: values.source,
    raw_lines: values.rawLines,
    parsed_kills: values.parsedKills,
    written_kills: values.writtenKills,
    joins: values.joins,
    disconnects: values.disconnects,
    playerlist_snapshots: values.playerlistSnapshots,
    duplicate_skips: values.duplicateSkips,
    failed_writes: values.failedWrites,
  });
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
    ignoreExistingCursor?: boolean;
  },
): Promise<AdmFixtureImportResult> {
  await ensureAdmSyncSchema(env);
  const now = new Date().toISOString();
  const triggerType = input.triggerType ?? "manual";
  const maxLinesPerRun = clampPositiveInteger(input.maxLinesPerRun ?? 50000, 50000);
  const existingState = await getSyncState(env, input.context.linkedServerId);
  const savedCursorBefore = Number(existingState?.last_processed_line ?? 0);
  const cursorBefore = input.ignoreExistingCursor ? 0 : savedCursorBefore;
  const cursorValidation = input.ignoreExistingCursor
    ? {
      cursorValidationStatus: "new_file" as AdmCursorValidationStatus,
      cursorValidationError: null,
      cursorRecoveryStrategy: null,
      cursorRecoveryReason: "manual_full_reprocess",
      previousLineHash: null,
      currentLineHash: null,
      cursorLineChecked: null,
      cursorHashMatched: null,
      startLine: 0,
    }
    : await validateAdmCursorForLines({
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
  const parserWarnings = buildParserWarnings(baseReport);
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
    importSource: triggerType,
    importedAt: now,
    importReportId: syncRunId,
    parserWarnings,
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
        await withManualAdmPhaseTimeout(upsertServerPublicCache(env, {
          guildId: input.guildId,
          planKey: input.planKey,
          publicServerName: input.publicServerName,
          lastAdmUpdateAt: now,
        }), "public cache update");
        publicCacheUpdated = true;
        cacheRefreshStatus = "updated";
      } catch {
        cacheRefreshStatus = "failed";
      }
    }

    if (input.queueDiscordPosts && input.guildId && input.planKey && (eventsCreated > 0 || killsCreated > 0 || buildEventsStored > 0)) {
      try {
        discordQueuesCreated = await withManualAdmPhaseTimeout(queueDiscordPostUpdatesForGuild(env, input.guildId, input.planKey, [
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
        ], "adm-data-change"), "Discord post queue");
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
    const syncRunMessage = buildAdmImportSyncRunMessage({
      source: triggerType,
      filename: context.admFileName,
      rawLines: input.lines.length,
      parsedKills: baseReport.parsedPvpKills,
      writtenKills: killEventsStored,
      joins: joinsCreated,
      disconnects: disconnectsCreated,
      playerlistSnapshots: baseReport.parsedPlayerlistSnapshots,
      duplicateSkips: duplicateLines,
      failedWrites: 0,
      importedAt: now,
    });
    await recordSyncRun(env, {
      id: syncRunId,
      linkedServerId: context.linkedServerId,
      sourceServiceId: context.nitradoServiceId,
      triggerType,
      status: "completed",
      message: syncRunMessage,
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
      rawLines: input.lines.length,
      rawEventsStored,
      playerEventsStored,
      killEventsStored,
      buildEventsStored,
      eventsCreated,
      killsCreated,
      deathsCreated,
      joinsCreated,
      disconnectsCreated,
      playerlistSnapshotsParsed: baseReport.parsedPlayerlistSnapshots,
      duplicateLines,
      publicCacheUpdated,
      discordQueuesCreated,
      importReportId: syncRunId,
      importedAt: now,
      parserWarnings,
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
      lastProcessedLine: savedCursorBefore,
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
      rawLines: input.lines.length,
      rawEventsStored: 0,
      playerEventsStored: 0,
      killEventsStored: 0,
      buildEventsStored: 0,
      eventsCreated: 0,
      killsCreated: 0,
      deathsCreated: 0,
      joinsCreated: 0,
      disconnectsCreated: 0,
      playerlistSnapshotsParsed: baseReport.parsedPlayerlistSnapshots,
      duplicateLines: 0,
      publicCacheUpdated: false,
      discordQueuesCreated: 0,
      importReportId: syncRunId,
      importedAt: now,
      parserWarnings,
      totalKills: 0,
      totalDeaths: 0,
      longestKillDistance: 0,
    };
  }
}

export async function importAdmTextForServer(
  env: Env,
  input: {
    linkedServerId: string;
    filename: string;
    admText: string;
    source?: "manual_paste" | "manual_upload" | string;
    maxLinesPerRun?: number;
  },
): Promise<ManualAdmTextImportResult> {
  await ensureAdmSyncSchema(env);
  const filename = sanitizeManualAdmFilename(input.filename);
  if (!filename) throw new Error("A valid ADM filename is required.");
  const rawText = typeof input.admText === "string" ? input.admText : "";
  if (!rawText.trim()) throw new Error("ADM text is required.");

  const server = await getLinkedServerForAdmImport(env, input.linkedServerId);
  if (!server) throw new Error("Server not found.");
  const scope = withAdmFile(verifyAdmServerScope(server, crypto.randomUUID()), filename);
  const lines = splitAdmText(rawText);
  if (!lines.length) throw new Error("ADM text did not contain readable lines.");
  const source = input.source ?? "manual_paste";
  const result = await importReadableAdmLinesIntoDatabase(env, {
    context: scope,
    lines,
    admPath: filename,
    triggerType: source,
    maxLinesPerRun: input.maxLinesPerRun ?? 50000,
    guildId: server.guild_id,
    planKey: server.plan_key,
    publicServerName: firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name),
    updatePublicCache: Boolean(server.guild_id),
    queueDiscordPosts: Boolean(server.guild_id && isActiveSubscriptionStatus(server.subscription_status)),
    ignoreExistingCursor: true,
  });
  const warnings = [
    ...result.parserWarnings,
    ...(result.report.cacheRefreshStatus === "failed" ? ["Public cache update failed after ADM rows were written."] : []),
    ...(result.report.discordQueueStatus === "failed" ? ["Discord auto-post queueing failed after ADM rows were written."] : []),
  ];
  const killPreviews = buildKillPreviews(lines, filename, 5);

  return {
    ok: true,
    filename,
    source,
    raw_lines: result.rawLines,
    raw_kill_lines_found: result.report.rawKilledByLinesFound,
    parsed_kills: result.report.parsedPvpKills,
    written_kills: result.report.writtenKills,
    deaths: result.report.writtenKills + result.report.parsedSuicides + result.report.parsedUncreditedDeaths,
    joins: result.joinsCreated,
    disconnects: result.disconnectsCreated,
    playerlist_snapshots: result.playerlistSnapshotsParsed,
    suicides: result.report.parsedSuicides,
    uncredited_deaths: result.report.parsedUncreditedDeaths,
    hit_lines: result.report.parsedHitLines,
    raw_events_stored: result.rawEventsStored,
    player_events_stored: result.playerEventsStored,
    duplicate_skips: Math.max(result.duplicateLines, result.report.duplicateSkips),
    failed_writes: result.report.failedWrites,
    public_cache_updated: result.publicCacheUpdated,
    discord_jobs_queued: result.discordQueuesCreated,
    import_report_id: result.importReportId,
    imported_at: result.importedAt,
    parser_warnings: warnings,
    total_kills: result.totalKills,
    total_deaths: result.totalDeaths,
    kill_previews: killPreviews,
    import_report: result.report,
  };
}

export async function importAdmFilesForServer(
  env: Env,
  input: {
    linkedServerId: string;
    files: ManualAdmBulkFileInput[];
    source?: "manual_file_upload" | "manual_paste" | string;
    previewOnly?: boolean;
  },
): Promise<ManualAdmBulkImportResult> {
  const source = input.source ?? "manual_file_upload";
  const files = normaliseBulkAdmFiles(input.files);
  if (!files.length) throw new Error("At least one ADM file is required.");

  const results: ManualAdmBulkFileResult[] = [];
  for (const file of files) {
    try {
      if (input.previewOnly) {
        const preview = previewManualAdmText(file);
        results.push({
          ok: true,
          filename: preview.filename,
          source,
          status: "previewed",
          raw_lines: preview.raw_lines,
          raw_kill_lines_found: preview.raw_kill_lines_found,
          parsed_kills: preview.parsed_kills,
          written_kills: 0,
          deaths: preview.parsed_kills + preview.suicides + preview.uncredited_deaths,
          joins: preview.joins,
          disconnects: preview.disconnects,
          playerlist_snapshots: preview.playerlist_snapshots,
          suicides: preview.suicides,
          uncredited_deaths: preview.uncredited_deaths,
          hit_lines: preview.hit_lines,
          raw_events_stored: 0,
          player_events_stored: 0,
          duplicate_skips: 0,
          failed_writes: 0,
          public_cache_updated: false,
          discord_jobs_queued: 0,
          parser_warnings: preview.parser_warnings,
          kill_previews: preview.kill_previews.slice(0, 5),
          import_report_id: null,
          imported_at: null,
        });
        continue;
      }

      const imported = await importAdmTextForServer(env, {
        linkedServerId: input.linkedServerId,
        filename: file.filename,
        admText: file.admText,
        source,
      });
      results.push({
        ok: true,
        filename: imported.filename,
        source: imported.source,
        status: "imported",
        raw_lines: imported.raw_lines,
        raw_kill_lines_found: imported.raw_kill_lines_found,
        parsed_kills: imported.parsed_kills,
        written_kills: imported.written_kills,
        deaths: imported.deaths,
        joins: imported.joins,
        disconnects: imported.disconnects,
        playerlist_snapshots: imported.playerlist_snapshots,
        suicides: imported.suicides,
        uncredited_deaths: imported.uncredited_deaths,
        hit_lines: imported.hit_lines,
        raw_events_stored: imported.raw_events_stored,
        player_events_stored: imported.player_events_stored,
        duplicate_skips: imported.duplicate_skips,
        failed_writes: imported.failed_writes,
        public_cache_updated: imported.public_cache_updated,
        discord_jobs_queued: imported.discord_jobs_queued,
        parser_warnings: imported.parser_warnings,
        kill_previews: imported.kill_previews.slice(0, 5),
        import_report_id: imported.import_report_id,
        imported_at: imported.imported_at,
      });
    } catch (error) {
      results.push({
        ok: false,
        filename: sanitizeManualAdmFilename(file.filename) ?? file.filename,
        source,
        status: "failed",
        raw_lines: splitAdmText(file.admText).length,
        raw_kill_lines_found: 0,
        parsed_kills: 0,
        written_kills: 0,
        deaths: 0,
        joins: 0,
        disconnects: 0,
        playerlist_snapshots: 0,
        suicides: 0,
        uncredited_deaths: 0,
        hit_lines: 0,
        raw_events_stored: 0,
        player_events_stored: 0,
        duplicate_skips: 0,
        failed_writes: 0,
        public_cache_updated: false,
        discord_jobs_queued: 0,
        parser_warnings: [],
        kill_previews: [],
        import_report_id: null,
        imported_at: null,
        error_code: "adm_file_import_failed",
        message: error instanceof Error ? error.message : "ADM file import failed.",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summariseBulkAdmImportResults(input.previewOnly ? "preview" : "import", source, results);
}

const MANUAL_ADM_IMPORT_CHUNK_SIZE = 25;
const MANUAL_ADM_UPLOAD_CHUNK_SIZE = 10;
const SCHEDULED_ADM_IMPORT_CHUNK_SIZE = DEFAULT_ADM_MAX_IMPORT_LINES_PER_INVOCATION;
const SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK = 1;
const SCHEDULED_ADM_IMPORT_SOURCE = "scheduled_nitrado";

type AdmInvocationBudget = {
  maxFilesPerInvocation: number;
  maxUnreadableRetriesPerInvocation: number;
  maxReadAttemptsPerFile: number;
  maxTokenizedAttemptsPerFile: number;
  maxChunkedReadChunks: number;
  maxImportLinesPerInvocation: number;
  maxD1WriteBatchesPerInvocation: number;
  diagnosticRows: {
    maxRows: number;
    rowsRecorded: number;
  };
};

function getAdmInvocationBudget(env: Env): AdmInvocationBudget {
  return {
    maxFilesPerInvocation: readAdmBudgetInt(env, "ADM_MAX_FILES_PER_INVOCATION", DEFAULT_ADM_MAX_FILES_PER_INVOCATION, 1, 12),
    maxUnreadableRetriesPerInvocation: readAdmBudgetInt(env, "ADM_MAX_UNREADABLE_RETRIES_PER_INVOCATION", DEFAULT_ADM_MAX_UNREADABLE_RETRIES_PER_INVOCATION, 0, 10),
    maxReadAttemptsPerFile: readAdmBudgetInt(env, "ADM_MAX_READ_ATTEMPTS_PER_FILE", DEFAULT_ADM_MAX_READ_ATTEMPTS_PER_FILE, 1, 6),
    maxTokenizedAttemptsPerFile: readAdmBudgetInt(env, "ADM_MAX_TOKENIZED_ATTEMPTS_PER_FILE", DEFAULT_ADM_MAX_TOKENIZED_ATTEMPTS_PER_FILE, 1, 5),
    maxChunkedReadChunks: readAdmBudgetInt(env, "ADM_MAX_CHUNKED_READ_CHUNKS", DEFAULT_ADM_MAX_CHUNKED_READ_CHUNKS, 1, 12),
    maxImportLinesPerInvocation: readAdmBudgetInt(env, "ADM_MAX_IMPORT_LINES_PER_INVOCATION", DEFAULT_ADM_MAX_IMPORT_LINES_PER_INVOCATION, 25, 1000),
    maxD1WriteBatchesPerInvocation: readAdmBudgetInt(env, "ADM_MAX_D1_WRITE_BATCHES_PER_INVOCATION", DEFAULT_ADM_MAX_D1_WRITE_BATCHES_PER_INVOCATION, 1, 50),
    diagnosticRows: {
      maxRows: readAdmBudgetInt(env, "ADM_MAX_DIAGNOSTIC_ROWS_PER_INVOCATION", DEFAULT_ADM_MAX_DIAGNOSTIC_ROWS_PER_INVOCATION, 0, 100),
      rowsRecorded: 0,
    },
  };
}

function readAdmBudgetInt(env: Env, key: string, fallback: number, min: number, max: number) {
  const value = (env as unknown as Record<string, unknown>)[key];
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
let admSchemaEnsureSkipDepth = 0;

type AdmImportJobRow = {
  id: string;
  server_id: string;
  source_service_id: string | null;
  filename: string;
  source: string;
  status: string;
  adm_text: string;
  total_lines: number;
  current_line: number;
  chunk_size: number;
  total_chunks: number;
  chunks_processed: number;
  import_hit_lines?: number | null;
  raw_kill_lines_found?: number | null;
  last_chunk_index?: number | null;
  failed_chunk_index?: number | null;
  parsed_kills: number;
  written_kills: number;
  duplicate_skips: number;
  joins: number;
  disconnects: number;
  playerlist_snapshots: number;
  deaths: number;
  suicides: number;
  uncredited_deaths: number;
  hit_lines: number;
  raw_events: number;
  player_events: number;
  failed_writes: number;
  public_cache_updated: number;
  discord_jobs_queued: number;
  warnings_json: string | null;
  error_message: string | null;
  result_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

type AdmChunkWriteResult = {
  rawLines: number;
  rawKilledByLinesFound: number;
  parsedKills: number;
  writtenKills: number;
  deaths: number;
  joins: number;
  disconnects: number;
  playerlistSnapshots: number;
  suicides: number;
  uncreditedDeaths: number;
  hitLines: number;
  rawEventsStored: number;
  playerEventsStored: number;
  buildEventsStored: number;
  duplicateSkips: number;
  failedWrites: number;
  eventsCreated: number;
  lastEventAt: string | null;
  parserWarnings: string[];
};

export async function createAdmImportJobForServer(
  env: Env,
  input: {
    linkedServerId: string;
    filename: string;
    admText: string;
    source?: "manual_file_upload" | "manual_paste" | string;
    chunkSize?: number;
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const server = await getLinkedServerForAdmImport(env, input.linkedServerId);
  if (!server) throw new Error("Server not found.");
  const filename = sanitizeManualAdmFilename(input.filename);
  if (!filename) throw new Error("A valid ADM filename is required.");
  const admText = typeof input.admText === "string" ? input.admText : "";
  const lines = splitAdmText(admText);
  if (!lines.length) throw new Error("ADM text did not contain readable lines.");

  const now = new Date().toISOString();
  const chunkSize = Math.max(1, Math.min(100, Math.trunc(input.chunkSize ?? MANUAL_ADM_IMPORT_CHUNK_SIZE)));
  const totalChunks = Math.max(1, Math.ceil(lines.length / chunkSize));
  const id = crypto.randomUUID();
  const source = input.source ?? "manual_file_upload";
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO adm_import_jobs (
        id, server_id, source_service_id, filename, source, status, adm_text,
        total_lines, current_line, chunk_size, total_chunks, chunks_processed,
        parsed_kills, written_kills, duplicate_skips, joins, disconnects,
        playerlist_snapshots, deaths, suicides, uncredited_deaths, hit_lines,
        raw_events, player_events, failed_writes, public_cache_updated,
        discord_jobs_queued, warnings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', ?, ?)`,
    )
    .bind(
      id,
      input.linkedServerId,
      server.nitrado_service_id,
      filename,
      source,
      admText,
      lines.length,
      chunkSize,
      totalChunks,
      now,
      now,
    )
    .run();

  const row = await getAdmImportJob(env, input.linkedServerId, id);
  if (!row) throw new Error("ADM import job could not be created.");
  return toAdmImportJobProgress(row);
}

export async function startAdmImportLineJobForServer(
  env: Env,
  input: {
    linkedServerId: string;
    filename: string;
    totalLines: number;
    totalChunks: number;
    source?: "manual_file_upload" | "manual_paste" | string;
    chunkSize?: number;
    importHitLines?: boolean;
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const server = await getLinkedServerForAdmImport(env, input.linkedServerId);
  if (!server) throw new Error("Server not found.");
  const filename = sanitizeManualAdmFilename(input.filename);
  if (!filename) throw new Error("A valid ADM filename is required.");
  const totalLines = Math.max(1, Math.trunc(Number(input.totalLines ?? 0)));
  const chunkSize = Math.max(1, Math.min(25, Math.trunc(input.chunkSize ?? MANUAL_ADM_UPLOAD_CHUNK_SIZE)));
  const totalChunks = Math.max(1, Math.ceil(totalLines / chunkSize), Math.trunc(Number(input.totalChunks ?? Math.ceil(totalLines / chunkSize))));
  const now = new Date().toISOString();
  const source = input.source ?? "manual_file_upload";
  const db = requireDb(env);
  const existingJob = await getAdmImportJobForFilename(env, input.linkedServerId, filename);
  if (existingJob && ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(String(existingJob.status))) {
    return toAdmImportJobProgress(existingJob);
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO adm_import_jobs (
        id, server_id, source_service_id, filename, source, status, adm_text,
        total_lines, current_line, chunk_size, total_chunks, chunks_processed,
        import_hit_lines, raw_kill_lines_found, last_chunk_index, failed_chunk_index,
        parsed_kills, written_kills, duplicate_skips, joins, disconnects,
        playerlist_snapshots, deaths, suicides, uncredited_deaths, hit_lines,
        raw_events, player_events, failed_writes, public_cache_updated,
        discord_jobs_queued, warnings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', '', ?, 0, ?, ?, 0, ?, 0, -1, NULL, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', ?, ?)`,
    )
    .bind(
      id,
      input.linkedServerId,
      server.nitrado_service_id,
      filename,
      source,
      totalLines,
      chunkSize,
      totalChunks,
      input.importHitLines ? 1 : 0,
      now,
      now,
    )
    .run();

  const row = await getAdmImportJob(env, input.linkedServerId, id);
  if (!row) throw new Error("ADM import job could not be created.");
  return toAdmImportJobProgress(row);
}

export async function processAdmImportJobLineChunk(
  env: Env,
  input: {
    linkedServerId: string;
    jobId: string;
    filename: string;
    chunkIndex: number;
    startLine: number;
    lines: string[];
    previousLines?: string[];
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const row = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!row) throw new Error("ADM import job not found.");
  if (row.status === "completed" || row.status === "completed_with_warnings") return toAdmImportJobProgress(row);
  if (row.status === "cancelled") return toAdmImportJobProgress(row);
  if (row.status === "cancelled") return toAdmImportJobProgress(row);
  if (row.status === "cancelled") return toAdmImportJobProgress(row);

  const server = await getLinkedServerForAdmImport(env, input.linkedServerId);
  if (!server) throw new Error("Server not found.");
  if (sanitizeManualAdmFilename(input.filename) !== row.filename) throw new Error("ADM import chunk filename does not match the job.");

  const chunkLines = Array.isArray(input.lines) ? input.lines.filter((line): line is string => typeof line === "string") : [];
  if (!chunkLines.some((line) => line.trim().length > 0)) throw new Error("ADM import chunk did not contain readable lines.");
  const startLine = Math.max(0, Math.trunc(Number(input.startLine ?? 0)));
  const currentLine = Math.max(0, Number(row.current_line ?? 0));
  const totalLines = Math.max(0, Number(row.total_lines ?? 0));
  const chunkIndex = Math.max(0, Math.trunc(Number(input.chunkIndex ?? 0)));
  const db = requireDb(env);

  if (currentLine >= totalLines && totalLines > 0) {
    return await finalizeAdmImportJob(env, server, row, null);
  }
  if (startLine < currentLine) {
    return { ...toAdmImportJobProgress(row), already_processed: true };
  }
  if (startLine > currentLine) {
    throw new Error(`ADM import chunk is out of order. Expected line ${currentLine}, received ${startLine}.`);
  }

  await db
    .prepare("UPDATE adm_import_jobs SET status = 'writing', error_message = NULL, failed_chunk_index = NULL, updated_at = ? WHERE id = ? AND server_id = ?")
    .bind(new Date().toISOString(), row.id, input.linkedServerId)
    .run();

  try {
    const context = withAdmFile(verifyAdmServerScope(server, row.id), row.filename);
    const chunkResult = await writeAdmImportChunk(env, {
      context,
      chunkLines,
      previousLines: Array.isArray(input.previousLines) ? input.previousLines.filter((line): line is string => typeof line === "string") : [],
      startLine,
      endLine: startLine + chunkLines.length,
      includeHitLines: Number(row.import_hit_lines ?? 0) === 1,
      triggerType: row.source,
    });
    const warnings = [...parseJobWarnings(row), ...chunkResult.parserWarnings.map((warning) => `${row.filename}: ${warning}`)];
    const nextCurrentLine = Math.min(totalLines || startLine + chunkLines.length, startLine + chunkLines.length);
    const chunksProcessed = Math.max(Number(row.chunks_processed ?? 0), chunkIndex + 1);
    await db
      .prepare(
        `UPDATE adm_import_jobs SET
          status = 'queued',
          current_line = ?,
          chunks_processed = ?,
          raw_kill_lines_found = raw_kill_lines_found + ?,
          last_chunk_index = ?,
          failed_chunk_index = NULL,
          parsed_kills = parsed_kills + ?,
          written_kills = written_kills + ?,
          duplicate_skips = duplicate_skips + ?,
          joins = joins + ?,
          disconnects = disconnects + ?,
          playerlist_snapshots = playerlist_snapshots + ?,
          deaths = deaths + ?,
          suicides = suicides + ?,
          uncredited_deaths = uncredited_deaths + ?,
          hit_lines = hit_lines + ?,
          raw_events = raw_events + ?,
          player_events = player_events + ?,
          failed_writes = failed_writes + ?,
          warnings_json = ?,
          updated_at = ?
         WHERE id = ? AND server_id = ?`,
      )
      .bind(
        nextCurrentLine,
        chunksProcessed,
        chunkResult.rawKilledByLinesFound,
        chunkIndex,
        chunkResult.parsedKills,
        chunkResult.writtenKills,
        chunkResult.duplicateSkips,
        chunkResult.joins,
        chunkResult.disconnects,
        chunkResult.playerlistSnapshots,
        chunkResult.deaths,
        chunkResult.suicides,
        chunkResult.uncreditedDeaths,
        chunkResult.hitLines,
        chunkResult.rawEventsStored,
        chunkResult.playerEventsStored,
        chunkResult.failedWrites,
        JSON.stringify(warnings),
        new Date().toISOString(),
        row.id,
        input.linkedServerId,
      )
      .run();

    const updated = await getAdmImportJob(env, input.linkedServerId, input.jobId);
    if (!updated) throw new Error("ADM import job disappeared after chunk write.");
    if (nextCurrentLine >= totalLines && totalLines > 0) {
      return await finalizeAdmImportJob(env, server, updated, null);
    }
    return toAdmImportJobProgress(updated);
  } catch (error) {
    if (chunkLines.length === 1) {
      return await skipFailedAdmImportLine(env, {
        row,
        linkedServerId: input.linkedServerId,
        chunkIndex,
        nextCurrentLine: Math.min(Number(row.total_lines ?? startLine + 1), startLine + 1),
        message: `${row.filename}: skipped line ${startLine + 1} after parser/write failure. ${safeSyncErrorMessage(error)}`,
      });
    }
    await db
      .prepare("UPDATE adm_import_jobs SET status = 'failed', error_message = ?, failed_chunk_index = ?, failed_writes = failed_writes + 1, updated_at = ? WHERE id = ? AND server_id = ?")
      .bind(safeSyncErrorMessage(error), chunkIndex, new Date().toISOString(), row.id, input.linkedServerId)
      .run();
    throw error;
  }
}

async function skipFailedAdmImportLine(
  env: Env,
  input: {
    row: AdmImportJobRow;
    linkedServerId: string;
    chunkIndex: number;
    nextCurrentLine: number;
    message: string;
  },
) {
  const warnings = [...parseJobWarnings(input.row), input.message];
  const chunksProcessed = Math.max(Number(input.row.chunks_processed ?? 0), input.chunkIndex + 1);
  await requireDb(env)
    .prepare(
      `UPDATE adm_import_jobs SET
        status = 'queued',
        current_line = ?,
        chunks_processed = ?,
        failed_writes = failed_writes + 1,
        warnings_json = ?,
        last_chunk_index = ?,
        failed_chunk_index = NULL,
        error_message = NULL,
        updated_at = ?
       WHERE id = ? AND server_id = ?`,
    )
    .bind(
      input.nextCurrentLine,
      chunksProcessed,
      JSON.stringify(warnings),
      input.chunkIndex,
      new Date().toISOString(),
      input.row.id,
      input.linkedServerId,
    )
    .run();
  const updated = await getAdmImportJob(env, input.linkedServerId, input.row.id);
  if (!updated) throw new Error("ADM import job disappeared after failed line skip.");
  return toAdmImportJobProgress(updated);
}

export async function finishAdmImportLineJobForServer(
  env: Env,
  input: {
    linkedServerId: string;
    jobId: string;
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const row = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!row) throw new Error("ADM import job not found.");
  if (row.status === "completed" || row.status === "completed_with_warnings") return toAdmImportJobProgress(row);
  if (Number(row.current_line ?? 0) < Number(row.total_lines ?? 0)) {
    throw new Error(`ADM import job is incomplete. Processed ${row.current_line} of ${row.total_lines} lines.`);
  }
  const server = await getLinkedServerForAdmImport(env, input.linkedServerId);
  if (!server) throw new Error("Server not found.");
  return await finalizeAdmImportJob(env, server, row, null);
}

export async function retryAdmImportLineJobForServer(
  env: Env,
  input: {
    linkedServerId: string;
    jobId: string;
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const row = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!row) throw new Error("ADM import job not found.");
  if (row.status === "completed" || row.status === "completed_with_warnings") return toAdmImportJobProgress(row);
  const db = requireDb(env);
  await db
    .prepare("UPDATE adm_import_jobs SET status = 'queued', error_message = NULL, failed_chunk_index = NULL, updated_at = ? WHERE id = ? AND server_id = ?")
    .bind(new Date().toISOString(), row.id, input.linkedServerId)
    .run();
  const updated = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!updated) throw new Error("ADM import job disappeared after retry reset.");
  return toAdmImportJobProgress(updated);
}

export async function cancelAdmImportLineJobForServer(
  env: Env,
  input: {
    linkedServerId: string;
    jobId: string;
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const row = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!row) throw new Error("ADM import job not found.");
  if (row.status === "completed" || row.status === "completed_with_warnings" || row.status === "cancelled") return toAdmImportJobProgress(row);
  await requireDb(env)
    .prepare(
      `UPDATE adm_import_jobs SET
        status = 'cancelled',
        error_message = COALESCE(error_message, 'ADM import cancelled by owner/admin. Already written events were preserved.'),
        updated_at = ?
       WHERE id = ? AND server_id = ?`,
    )
    .bind(new Date().toISOString(), row.id, input.linkedServerId)
    .run();
  const updated = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!updated) throw new Error("ADM import job disappeared after cancel.");
  return toAdmImportJobProgress(updated);
}

export async function processPendingAdmImportJobs(
  env: Env,
  options: {
    maxJobs?: number;
    maxChunksPerJob?: number;
    maxRuntimeMs?: number;
    source?: string;
    linkedServerId?: string | null;
    assumeSchemaReady?: boolean;
  } = {},
): Promise<PendingAdmImportJobsResult> {
  if (options.assumeSchemaReady !== true) await ensureAdmSyncSchema(env);
  const maxJobs = clampPositiveInteger(options.maxJobs ?? 5, 5);
  const maxChunksPerJob = clampPositiveInteger(options.maxChunksPerJob ?? SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK, SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK);
  const maxRuntimeMs = clampPositiveInteger(options.maxRuntimeMs ?? 20_000, 20_000);
  const deadline = Date.now() + Math.max(1000, maxRuntimeMs - 1000);
  const source = options.source ?? SCHEDULED_ADM_IMPORT_SOURCE;
  await recoverStaleAdmImportJobs(env, source);
  const rows = await requireDb(env)
    .prepare(
      `SELECT * FROM adm_import_jobs
       WHERE source = ?
         AND (? IS NULL OR server_id = ?)
         AND status IN ('queued', 'processing', 'parsing', 'writing', 'failed_retryable', 'rebuilding')
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(source, options.linkedServerId ?? null, options.linkedServerId ?? null, maxJobs * 3)
    .all<AdmImportJobRow>();

  const results: AdmImportJobProgressResult[] = [];
  const processedServerIds = new Set<string>();
  let chunksProcessed = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  for (const row of rows.results ?? []) {
    if (Date.now() >= deadline) break;
    if (processedServerIds.has(row.server_id) || processedServerIds.size >= maxJobs) continue;
    processedServerIds.add(row.server_id);
    try {
      const previousChunksProcessed = Number(row.chunks_processed ?? 0);
      const result = await processAdmImportJobChunksById(env, row.server_id, row.id, maxChunksPerJob, deadline);
      chunksProcessed += Math.max(0, result.chunks_processed - previousChunksProcessed);
      if (result.status === "completed" || result.status === "completed_with_warnings") completedJobs += 1;
      results.push(result);
    } catch (error) {
      failedJobs += 1;
      const latest = await getAdmImportJob(env, row.server_id, row.id);
      if (latest) results.push(toAdmImportJobProgress(latest));
      await recordAdmImportJobProgressInSyncState(env, latest ?? row, "failed_retryable", `ADM chunk import paused for retry. ${safeSyncErrorMessage(error)}`).catch(() => null);
    }
  }

  return {
    processedJobs: results.length,
    completedJobs,
    chunksProcessed,
    failedJobs,
    results,
  };
}

export async function processAdmImportJobsUntilBudget(
  env: Env,
  options: {
    maxJobs?: number;
    maxChunksPerJob?: number;
    maxRuntimeMs?: number;
    source?: string;
    linkedServerId?: string | null;
    assumeSchemaReady?: boolean;
  } = {},
): Promise<PendingAdmImportJobsResult> {
  return processPendingAdmImportJobs(env, options);
}

export async function planAdmBackfillJobsForServer(
  env: Env,
  userId: string,
  linkedServerId: string,
  options: {
    maxJobsToCreate?: number;
    triggerType?: string;
    processImmediately?: boolean;
    chunksToProcess?: number;
    scheduledBudgeted?: boolean;
    skipMetadataRefresh?: boolean;
  } = {},
): Promise<AdmBackfillPlanResult> {
  await ensureAdmSyncSchema(env);
  const owned = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!owned) throw new Error("No linked server found");
  const linkedServer = await getLinkedServerForAdmImport(env, linkedServerId);
  if (!linkedServer || linkedServer.user_id !== userId) throw new Error("No linked server found");
  const scope = verifyAdmServerScope(linkedServer, crypto.randomUUID());
  const scheduledBudgeted = options.scheduledBudgeted === true;
  const admBudget = getAdmInvocationBudget(env);
  if (!options.skipMetadataRefresh) {
    await refreshNitradoServerMetadata(env, {
      linkedServerId: scope.linkedServerId,
      userId: linkedServer.user_id,
      force: true,
      softFail: true,
    }).catch(() => null);
  }

  const existingState = await getSyncState(env, scope.linkedServerId);
  const isMock = isMockNitrado(env.MOCK_NITRADO);
  const preferredAdmPath = existingState?.latest_adm_path ?? linkedServer.adm_path ?? null;
  const batch = await getReadableAdmFilesForLinkedServer(env, linkedServer, {
    isMock,
    readMode: scheduledBudgeted ? "sample" : "full",
    preferredAdmPath,
    previousLatestAdmFileName: null,
    maxFiles: scheduledBudgeted ? admBudget.maxFilesPerInvocation : Math.min(getAdmBackfillReadLimit(linkedServer.plan_key), admBudget.maxFilesPerInvocation),
    lookbackFiles: scheduledBudgeted ? 10 : 12,
    directPreferredFirst: true,
    maxListDirs: scheduledBudgeted ? 2 : 8,
    maxListSearches: scheduledBudgeted ? 1 : 3,
    budget: admBudget,
  });
  await recordDiscoveredAdmFiles(env, scope, batch.candidates);

  const newestAvailable = selectNewestDiscoveredAdmFile(batch.candidates);
  const newestReadable = selectNewestReadableAdmFile(batch.files);
  if (newestAvailable?.path) {
    await saveServerAdmPath(env, scope.linkedServerId, newestAvailable.path.replace(/^\/+/, ""));
  }

  const existingJobs = await getAdmImportJobsForServer(env, scope.linkedServerId);
  const handledFilenames = await getHandledAdmFilenames(env, scope.linkedServerId, scope.nitradoServiceId);
  const readableFiles = [...batch.files];
  if (readableFiles.length > 0) {
    await resetAdmReadFailureCounter(env, scope.linkedServerId);
  }
  const retryPromotion = await retryUnreadableAdmFileStatesForServer(env, linkedServer, scope, {
    handledFilenames,
    limit: scheduledBudgeted ? admBudget.maxUnreadableRetriesPerInvocation : Math.min(MANUAL_ADM_UNREADABLE_RETRY_FILES_PER_RUN, admBudget.maxUnreadableRetriesPerInvocation),
    budget: admBudget,
  });
  readableFiles.push(...retryPromotion.readableFiles);
  const readErrorByName = new Map<string, string | null>();
  const readDiagnosticByName = new Map<string, NonNullable<ReturnType<typeof latestAdmFileReadDiagnostic>>>();
  for (const error of batch.readErrors) {
    const [filename, ...rest] = error.split(":");
    const key = normalizeAdmFilenameKey(filename);
    if (key) readErrorByName.set(key, rest.join(":").trim() || error);
  }
  for (const [filename, error] of retryPromotion.readErrorsByFilename.entries()) {
    readErrorByName.set(normalizeAdmFilenameKey(filename), error);
  }
  const readableByName = new Map(readableFiles.map((file) => [normalizeAdmFilenameKey(file.name), file]));
  let plannerFiles: AdmBackfillPlannerFile[] = batch.candidates.map((file) => {
    const key = normalizeAdmFilenameKey(file.name);
    return {
      name: file.name,
      path: file.path,
      timestamp: file.timestamp,
      readable: readableByName.has(key),
      readError: readErrorByName.get(key) ?? findReadErrorForAdmFile(batch.readErrors, file.name) ?? batch.readError,
    };
  });
  const maxJobsToCreate = options.maxJobsToCreate ?? getAdmBackfillQueueLimit(linkedServer.plan_key);

  if (scheduledBudgeted && !isMock) {
    const preliminaryPlan = buildAdmBackfillPlan({
      files: plannerFiles,
      handledFilenames,
      existingJobs: existingJobs.map((job) => ({ filename: job.filename, status: job.status, source: job.source })),
      planKey: linkedServer.plan_key,
      maxJobsToCreate,
    });
    const exactReadLimit = Math.max(1, Math.min(3, Math.trunc(Number(maxJobsToCreate))));
    const exactReadNames = preliminaryPlan.activeJobFilename
      ? []
      : preliminaryPlan.missingFiles
        .filter((filename) => !readableByName.has(normalizeAdmFilenameKey(filename)))
        .slice(0, exactReadLimit);
    for (const filename of exactReadNames) {
      const candidate = batch.candidates.find((file) => normalizeAdmFilenameKey(file.name) === normalizeAdmFilenameKey(filename));
      if (!candidate) continue;
      const read = await readSpecificAdmFileForBackfill(env, linkedServer, candidate, admBudget);
      if (read.file) {
        readableFiles.push(read.file);
        readableByName.set(normalizeAdmFilenameKey(read.file.name), read.file);
      } else {
        readErrorByName.set(normalizeAdmFilenameKey(filename), read.error);
        if (read.diagnostic) readDiagnosticByName.set(normalizeAdmFilenameKey(filename), read.diagnostic);
      }
    }
    plannerFiles = batch.candidates.map((file) => {
      const key = normalizeAdmFilenameKey(file.name);
      return {
        name: file.name,
        path: file.path,
        timestamp: file.timestamp,
        readable: readableByName.has(key),
        readError: readErrorByName.get(key) ?? findReadErrorForAdmFile(batch.readErrors, file.name) ?? batch.readError,
      };
    });
  }

  const latestExistingJobs = retryPromotion.createdJobs.length
    ? await getAdmImportJobsForServer(env, scope.linkedServerId)
    : existingJobs;

  const plan = buildAdmBackfillPlan({
    files: plannerFiles,
    handledFilenames,
    existingJobs: latestExistingJobs.map((job) => ({ filename: job.filename, status: job.status, source: job.source })),
    planKey: linkedServer.plan_key,
    maxJobsToCreate,
  });

  const unreadableByName = new Map(plan.unreadableFiles.map((file) => [normalizeAdmFilenameKey(file.filename), file]));
  for (const candidate of batch.candidates) {
    const unreadable = unreadableByName.get(normalizeAdmFilenameKey(candidate.name));
    if (!unreadable) continue;
    await recordAdmFileAttempt(env, scope, candidate, {
      status: "unreadable",
      lineCount: 0,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      insertedKills: 0,
      parserSkippedLines: 0,
      message: unreadable.error ?? "ADM file exists on Nitrado but could not be downloaded. DZN will retry later without blocking newer files.",
      diagnostic: readDiagnosticByName.get(normalizeAdmFilenameKey(candidate.name)) ?? null,
    });
  }

  const createdJobs: AdmImportJobProgressResult[] = [...retryPromotion.createdJobs];
  for (const filename of plan.createFiles) {
    const readable = readableByName.get(normalizeAdmFilenameKey(filename));
    if (!readable?.lines.length) continue;
    const existingJob = await getAdmImportJobForFilename(env, scope.linkedServerId, filename);
    if (existingJob) continue;
    const created = await createAdmImportJobForServer(env, {
      linkedServerId: scope.linkedServerId,
      filename,
      admText: readable.lines.join("\n"),
      source: SCHEDULED_ADM_IMPORT_SOURCE,
      chunkSize: SCHEDULED_ADM_IMPORT_CHUNK_SIZE,
    });
    const row = await getAdmImportJob(env, scope.linkedServerId, created.job_id);
    if (row) {
      await recordAdmImportJobProgressInSyncState(env, row, "adm_backfill_queued", `Queued ADM backfill job for ${filename}. ${plan.nextAction}`);
    }
    createdJobs.push(row ? toAdmImportJobProgress(row) : created);
  }

  let activeJobRow = await getActiveAdmImportJob(env, scope.linkedServerId);
  if (!activeJobRow && createdJobs[0]) activeJobRow = await getAdmImportJob(env, scope.linkedServerId, createdJobs[0].job_id);
  let activeJob = activeJobRow ? toAdmImportJobProgress(activeJobRow) : null;
  if (activeJobRow && options.processImmediately !== false && activeJobRow.source === SCHEDULED_ADM_IMPORT_SOURCE) {
    activeJob = await processAdmImportJobChunksById(env, scope.linkedServerId, activeJobRow.id, options.chunksToProcess ?? SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK);
  }

  const completedFiles = existingJobs
    .filter((job) => isCompletedAdmImportJobStatus(job.status))
    .map((job) => job.filename);
  const status = activeJob || createdJobs.length ? "adm_backfill_queued" : plan.missingFiles.length ? "latest_adm_unreadable" : "adm_backfill_caught_up";
  const ok = true;
  const baseMessage = activeJob
    ? `ADM backfill is processing ${activeJob.filename} chunk ${Math.min(activeJob.total_chunks, activeJob.chunks_processed + 1)}/${activeJob.total_chunks}.`
    : createdJobs.length
      ? `Queued ${createdJobs.length} missing ADM file${createdJobs.length === 1 ? "" : "s"} for scheduled backfill.`
      : plan.missingFiles.length
        ? `Missing ADM files are unreadable or already queued. ${plan.nextAction}`
        : "ADM backfill is caught up.";
  const latestUnreadable = plan.unreadableFiles.at(-1) ?? null;
  const latestUnreadableDiagnostic = latestUnreadable
    ? readDiagnosticByName.get(normalizeAdmFilenameKey(latestUnreadable.filename)) ?? null
    : null;
  const budgetPaused = batch.filesFound > admBudget.maxFilesPerInvocation || plan.missingFiles.length > createdJobs.length + plan.unreadableFiles.length;
  const budgetMessage = budgetPaused
    ? "ADM sync paused after reaching per-invocation safety budget; remaining files will continue next run."
    : null;
  const syncSummary = plan.unreadableFiles.length || budgetMessage
    ? `ADM sync discovered ${batch.filesFound} files; ${readableFiles.length} readable; ${plan.unreadableFiles.length} unreadable; ${createdJobs.length} queued; diagnostics ${admBudget.diagnosticRows.rowsRecorded}/${admBudget.diagnosticRows.maxRows}.${latestUnreadable ? ` Latest unreadable ${latestUnreadable.filename} ${latestUnreadableDiagnostic?.httpStatus ? `HTTP ${latestUnreadableDiagnostic.httpStatus}` : latestUnreadableDiagnostic?.errorCode ?? latestUnreadableDiagnostic?.endpointKind ?? latestUnreadable.error ?? "read failed"}.` : ""}${budgetMessage ? ` ${budgetMessage}` : ""}`
    : null;
  const message = syncSummary ? `${baseMessage} ${syncSummary}` : baseMessage;

  if (newestReadable || retryPromotion.readableFiles.length > 0) {
    await resetAdmReadFailureCounter(env, scope.linkedServerId);
  }

  await upsertSyncState(env, scope.linkedServerId, {
    latestAdmFile: newestAvailable?.name ?? existingState?.latest_adm_file ?? null,
    latestAdmPath: newestAvailable?.path ?? preferredAdmPath,
    sourceServiceId: scope.nitradoServiceId,
    lastProcessedFile: existingState?.last_processed_file ?? null,
    lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
    lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
    status,
    message,
    lastSyncAt: new Date().toISOString(),
    linesRead: activeJob?.total_lines ?? Number(existingState?.last_lines_read ?? 0),
    linesProcessed: activeJob?.current_line ?? Number(existingState?.last_lines_processed ?? 0),
    rawEventsStored: activeJob?.raw_events_stored ?? Number(existingState?.last_raw_events_stored ?? 0),
    playerEventsStored: activeJob?.player_events_stored ?? Number(existingState?.last_player_events_stored ?? 0),
    killEventsStored: activeJob?.written_kills ?? Number(existingState?.last_kill_events_stored ?? 0),
    eventsCreated: activeJob ? activeJob.player_events_stored + activeJob.written_kills : Number(existingState?.last_events_created ?? 0),
    killsCreated: activeJob?.written_kills ?? Number(existingState?.last_kills_created ?? 0),
    unknownLines: Number(existingState?.last_unknown_lines ?? 0),
    duplicateLines: activeJob?.duplicate_skips ?? Number(existingState?.last_duplicate_lines ?? 0),
    syncDurationMs: 0,
    readableRoute: activeJob ? "scheduled_backfill_chunked_import" : existingState?.last_readable_route ?? null,
    rawKillLinesFound: activeJob?.parsed_kills ?? Number(existingState?.last_raw_kill_lines_found ?? 0),
    parsedKillLinesFound: activeJob?.parsed_kills ?? Number(existingState?.last_parsed_kill_lines_found ?? 0),
    parserSkippedLines: Number(existingState?.last_parser_skipped_lines ?? 0),
    unreadableFilesQueued: plan.unreadableFiles.length,
    newestUnprocessedAdmFile: plan.newestMissingFile,
  });

  return {
    ok,
    status,
    message,
    plan_key: linkedServer.plan_key,
    files_found: batch.filesFound,
    window_files: plan.windowFiles,
    missing_files: plan.missingFiles,
    queued_files: plan.queuedFiles,
    created_jobs: createdJobs,
    active_job: activeJob,
    completed_files: completedFiles,
    skipped_already_imported: plan.skippedAlreadyImported,
    unreadable_files: plan.unreadableFiles,
    oldest_missing_file: plan.oldestMissingFile,
    newest_missing_file: plan.newestMissingFile,
    newest_available_adm_file: newestAvailable?.name ?? batch.newestAdmFileName ?? null,
    newest_available_adm_timestamp: timestampIso(newestAvailable?.timestamp ?? extractAdmTimestampScore(newestAvailable?.name ?? batch.newestAdmFileName)),
    newest_readable_adm_file: newestReadable?.name ?? null,
    newest_readable_adm_timestamp: timestampIso(extractAdmTimestampScore(newestReadable?.name)),
    next_action: plan.nextAction,
  };
}

export async function createScheduledAdmImportJobForServer(
  env: Env,
  userId: string,
  linkedServerId: string,
  options: {
    chunksToProcess?: number;
    triggerType?: string;
    processImmediately?: boolean;
  } = {},
): Promise<ScheduledAdmImportJobResult> {
  await ensureAdmSyncSchema(env);
  const linkedServer = await getOwnedLinkedServer(env, userId, linkedServerId);
  if (!linkedServer) throw new Error("No linked server found");
  const scope = verifyAdmServerScope(linkedServer, crypto.randomUUID());
  await refreshNitradoServerMetadata(env, {
    linkedServerId: scope.linkedServerId,
    userId: linkedServer.user_id,
    force: true,
    softFail: true,
  }).catch(() => null);

  const existingState = await getSyncState(env, scope.linkedServerId);
  const isMock = isMockNitrado(env.MOCK_NITRADO);
  const preferredAdmPath = existingState?.latest_adm_path ?? linkedServer.adm_path ?? null;
  const preferredAdmFileName = existingState?.latest_adm_file ?? fileNameFromPath(preferredAdmPath);
  const batch = await getReadableAdmFilesForLinkedServer(env, linkedServer, {
    isMock,
    readMode: "full",
    preferredAdmPath,
    previousLatestAdmFileName: preferredAdmFileName,
    maxFiles: 12,
    directPreferredFirst: true,
    maxListDirs: 4,
    maxListSearches: 2,
  });
  await recordDiscoveredAdmFiles(env, scope, batch.candidates);
  const newestAvailable = selectNewestDiscoveredAdmFile(batch.candidates);
  const newestReadable = selectNewestReadableAdmFile(batch.files);
  if (newestReadable) {
    await resetAdmReadFailureCounter(env, scope.linkedServerId);
  }
  const completedCursorFile = getCompletedAdmCursorFile(existingState);
  const newestAvailableIsNew = isAdmFileNewerThan(newestAvailable?.name ?? null, completedCursorFile);
  const selected = newestAvailableIsNew
    ? findReadableAdmFileByName(batch.files, newestAvailable?.name ?? newestReadable?.name ?? null)
    : null;
  const now = new Date().toISOString();

  if (newestAvailable?.path) {
    await saveServerAdmPath(env, scope.linkedServerId, newestAvailable.path.replace(/^\/+/, ""));
  }

  if (!newestAvailableIsNew && newestAvailable?.name) {
    const existingJob = await getAdmImportJobForFilename(env, scope.linkedServerId, newestAvailable.name);
    const progress = existingJob ? toAdmImportJobProgress(existingJob) : null;
    await upsertSyncState(env, scope.linkedServerId, {
      latestAdmFile: newestAvailable.name,
      latestAdmPath: newestAvailable.path ?? preferredAdmPath,
      sourceServiceId: scope.nitradoServiceId,
      lastProcessedFile: existingState?.last_processed_file ?? completedCursorFile,
      lastProcessedLine: Number(existingState?.last_processed_line ?? 0),
      lastProcessedOffset: Number(existingState?.last_processed_offset ?? 0),
      status: "no_new_lines",
      message: `ADM file ${newestAvailable.name} is already imported. Scheduled sync is waiting for the next reset ADM file.`,
      lastSyncAt: now,
      linesRead: Number(existingState?.last_lines_read ?? 0),
      linesProcessed: Number(existingState?.last_lines_processed ?? 0),
      rawEventsStored: Number(existingState?.last_raw_events_stored ?? 0),
      playerEventsStored: Number(existingState?.last_player_events_stored ?? 0),
      killEventsStored: Number(existingState?.last_kill_events_stored ?? 0),
      eventsCreated: Number(existingState?.last_events_created ?? 0),
      killsCreated: Number(existingState?.last_kills_created ?? 0),
      unknownLines: Number(existingState?.last_unknown_lines ?? 0),
      duplicateLines: Number(existingState?.last_duplicate_lines ?? 0),
      syncDurationMs: 0,
      readableRoute: existingState?.last_readable_route ?? null,
      rawKillLinesFound: Number(existingState?.last_raw_kill_lines_found ?? 0),
      parsedKillLinesFound: Number(existingState?.last_parsed_kill_lines_found ?? 0),
      parserSkippedLines: Number(existingState?.last_parser_skipped_lines ?? 0),
      unreadableFilesQueued: 0,
      newestUnprocessedAdmFile: null,
    });
    return {
      ok: true,
      status: "no_new_lines",
      message: `ADM file ${newestAvailable.name} is already imported.`,
      job: progress,
      duplicateExistingJob: Boolean(progress),
      latestAdmFile: newestAvailable.name,
      latestAdmTimestamp: timestampIso(newestAvailable.timestamp ?? extractAdmTimestampScore(newestAvailable.name)),
      newestAvailableAdmFile: newestAvailable.name,
      newestAvailableAdmTimestamp: timestampIso(newestAvailable.timestamp ?? extractAdmTimestampScore(newestAvailable.name)),
      newestReadableAdmFile: newestReadable?.name ?? null,
      newestReadableAdmTimestamp: timestampIso(extractAdmTimestampScore(newestReadable?.name)),
    };
  }

  if (!selected?.lines.length) {
    const latestAdmFile = newestAvailable?.name ?? batch.newestAdmFileName ?? existingState?.latest_adm_file ?? null;
    const status = latestAdmFile ? "latest_adm_unreadable" : "no_adm_file";
    const readError = batch.readError ? ` Read error: ${batch.readError}` : "";
    const message = latestAdmFile
      ? `Latest ADM file found, but DZN could not download readable text yet. It will retry automatically.${readError}`
      : "No ADM file is available for scheduled chunk import yet.";
    if (newestAvailable?.name) {
      await recordAdmFileAttempt(env, scope, newestAvailable, {
        status: "unreadable",
        lineCount: 0,
        rawKillLinesFound: 0,
        parsedKillLinesFound: 0,
        insertedKills: 0,
        parserSkippedLines: 0,
        message,
      });
    }
    await upsertSyncState(env, scope.linkedServerId, {
      latestAdmFile,
      latestAdmPath: newestAvailable?.path ?? preferredAdmPath,
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
      syncDurationMs: 0,
      readableRoute: null,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      parserSkippedLines: 0,
      unreadableFilesQueued: latestAdmFile ? 1 : 0,
      newestUnprocessedAdmFile: latestAdmFile,
    });
    return {
      ok: false,
      status,
      message,
      job: null,
      duplicateExistingJob: false,
      latestAdmFile,
      latestAdmTimestamp: timestampIso(extractAdmTimestampScore(latestAdmFile)),
      newestAvailableAdmFile: newestAvailable?.name ?? latestAdmFile,
      newestAvailableAdmTimestamp: timestampIso(newestAvailable?.timestamp ?? extractAdmTimestampScore(latestAdmFile)),
      newestReadableAdmFile: null,
      newestReadableAdmTimestamp: null,
    };
  }

  const existingJob = await getAdmImportJobForFilename(env, scope.linkedServerId, selected.name);
  if (existingJob) {
    const progress = toAdmImportJobProgress(existingJob);
    const completed = isCompletedAdmImportJobStatus(progress.status);
    if (completed || existingJob.source !== SCHEDULED_ADM_IMPORT_SOURCE || !existingJob.adm_text) {
      await recordAdmImportJobProgressInSyncState(env, existingJob, completed ? "no_new_lines" : "processing_in_chunks", completed
        ? `ADM file ${selected.name} is already imported. DZN skipped duplicate scheduled processing.`
        : `ADM file ${selected.name} already has an import job from ${existingJob.source}.`);
      return {
        ok: true,
        status: completed ? "no_new_lines" : "processing_in_chunks",
        message: completed
          ? `ADM file ${selected.name} is already imported.`
          : `ADM file ${selected.name} already has an active import job.`,
        job: progress,
        duplicateExistingJob: true,
        latestAdmFile: selected.name,
        latestAdmTimestamp: timestampIso(extractAdmTimestampScore(selected.name)),
        newestAvailableAdmFile: newestAvailable?.name ?? selected.name,
        newestAvailableAdmTimestamp: timestampIso(newestAvailable?.timestamp ?? extractAdmTimestampScore(selected.name)),
        newestReadableAdmFile: selected.name,
        newestReadableAdmTimestamp: timestampIso(extractAdmTimestampScore(selected.name)),
      };
    }
    if (options.processImmediately === false) {
      await recordAdmImportJobProgressInSyncState(env, existingJob, "processing_in_chunks", `ADM file ${selected.name} already has an active scheduled chunk import job.`);
      return scheduledJobResultFromProgress(progress, true, selected.name, newestAvailable);
    }

    const continued = await processAdmImportJobChunksById(env, scope.linkedServerId, existingJob.id, options.chunksToProcess ?? SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK);
    return scheduledJobResultFromProgress(continued, true, selected.name, newestAvailable);
  }

  const created = await createAdmImportJobForServer(env, {
    linkedServerId: scope.linkedServerId,
    filename: selected.name,
    admText: selected.lines.join("\n"),
    source: SCHEDULED_ADM_IMPORT_SOURCE,
    chunkSize: SCHEDULED_ADM_IMPORT_CHUNK_SIZE,
  });
  await recordAdmImportJobProgressInSyncState(env, {
    id: created.job_id,
    server_id: scope.linkedServerId,
    source_service_id: scope.nitradoServiceId,
    filename: selected.name,
    source: SCHEDULED_ADM_IMPORT_SOURCE,
    status: created.status,
    adm_text: selected.lines.join("\n"),
    total_lines: created.total_lines,
    current_line: created.current_line,
    chunk_size: created.chunk_size,
    total_chunks: created.total_chunks,
    chunks_processed: created.chunks_processed,
    import_hit_lines: created.import_hit_lines ? 1 : 0,
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
    created_at: now,
    updated_at: now,
    completed_at: null,
  }, "adm_import_job_queued", `Queued scheduled ADM chunk import for ${selected.name}.`);

  if (options.processImmediately === false) {
    return scheduledJobResultFromProgress(created, false, selected.name, newestAvailable, "adm_import_job_queued");
  }

  const processed = await processAdmImportJobChunksById(env, scope.linkedServerId, created.job_id, options.chunksToProcess ?? SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK);
  return scheduledJobResultFromProgress(processed, false, selected.name, newestAvailable);
}

export async function processNextAdmImportJobChunk(
  env: Env,
  input: {
    linkedServerId: string;
    jobId: string;
  },
): Promise<AdmImportJobProgressResult> {
  await ensureAdmSyncSchema(env);
  const row = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  if (!row) throw new Error("ADM import job not found.");
  if (row.status === "completed" || row.status === "completed_with_warnings") return toAdmImportJobProgress(row);

  const server = await getLinkedServerForAdmImport(env, input.linkedServerId);
  if (!server) throw new Error("Server not found.");

  const lines = splitAdmText(row.adm_text);
  if (!lines.length) {
    throw new Error("ADM import job has no server-side ADM text. Reselect the file in the dashboard to continue this manual upload.");
  }
  const startLine = Math.max(0, Math.min(Number(row.current_line ?? 0), lines.length));
  const chunkSize = Math.max(1, Number(row.chunk_size ?? MANUAL_ADM_IMPORT_CHUNK_SIZE));
  const endLine = Math.min(lines.length, startLine + chunkSize);
  const now = new Date().toISOString();
  const db = requireDb(env);

  if (startLine >= lines.length) {
    return await finalizeAdmImportJob(env, server, row, lines);
  }

  await db
    .prepare("UPDATE adm_import_jobs SET status = 'writing', error_message = NULL, updated_at = ? WHERE id = ? AND server_id = ?")
    .bind(now, row.id, input.linkedServerId)
    .run();

  try {
    const context = withAdmFile(verifyAdmServerScope(server, row.id), row.filename);
    const chunkResult = await writeAdmImportChunk(env, {
      context,
      allLines: lines,
      startLine,
      endLine,
      includeHitLines: Number(row.import_hit_lines ?? 0) === 1,
      triggerType: row.source,
    });
    const warnings = [...parseJobWarnings(row), ...chunkResult.parserWarnings.map((warning) => `${row.filename}: ${warning}`)];
    const nextCurrentLine = endLine;
    const chunksProcessed = Math.max(Number(row.chunks_processed ?? 0) + 1, Math.ceil(nextCurrentLine / chunkSize));
    const status = nextCurrentLine >= lines.length ? "rebuilding" : "queued";
    await db
      .prepare(
        `UPDATE adm_import_jobs SET
          status = ?,
          current_line = ?,
          chunks_processed = ?,
          raw_kill_lines_found = raw_kill_lines_found + ?,
          last_chunk_index = ?,
          failed_chunk_index = NULL,
          parsed_kills = parsed_kills + ?,
          written_kills = written_kills + ?,
          duplicate_skips = duplicate_skips + ?,
          joins = joins + ?,
          disconnects = disconnects + ?,
          playerlist_snapshots = playerlist_snapshots + ?,
          deaths = deaths + ?,
          suicides = suicides + ?,
          uncredited_deaths = uncredited_deaths + ?,
          hit_lines = hit_lines + ?,
          raw_events = raw_events + ?,
          player_events = player_events + ?,
          failed_writes = failed_writes + ?,
          warnings_json = ?,
          updated_at = ?
         WHERE id = ? AND server_id = ?`,
      )
      .bind(
        status,
        nextCurrentLine,
        chunksProcessed,
        chunkResult.rawKilledByLinesFound,
        Number(row.chunks_processed ?? 0),
        chunkResult.parsedKills,
        chunkResult.writtenKills,
        chunkResult.duplicateSkips,
        chunkResult.joins,
        chunkResult.disconnects,
        chunkResult.playerlistSnapshots,
        chunkResult.deaths,
        chunkResult.suicides,
        chunkResult.uncreditedDeaths,
        chunkResult.hitLines,
        chunkResult.rawEventsStored,
        chunkResult.playerEventsStored,
        chunkResult.failedWrites,
        JSON.stringify(warnings),
        new Date().toISOString(),
        row.id,
        input.linkedServerId,
      )
      .run();

    const updated = await getAdmImportJob(env, input.linkedServerId, input.jobId);
    if (!updated) throw new Error("ADM import job disappeared after chunk write.");
    if (nextCurrentLine >= lines.length) return await finalizeAdmImportJob(env, server, updated, lines);
    return toAdmImportJobProgress(updated);
  } catch (error) {
    await db
      .prepare("UPDATE adm_import_jobs SET status = 'failed_retryable', error_message = ?, failed_chunk_index = ?, failed_writes = failed_writes + 1, updated_at = ? WHERE id = ? AND server_id = ?")
      .bind(safeSyncErrorMessage(error), Number(row.chunks_processed ?? 0), new Date().toISOString(), row.id, input.linkedServerId)
      .run();
    throw error;
  }
}

async function processAdmImportJobChunksById(env: Env, linkedServerId: string, jobId: string, maxChunks: number, deadlineMs = Number.POSITIVE_INFINITY) {
  const safeMaxChunks = clampPositiveInteger(maxChunks, SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK);
  let progress = await processNextAdmImportJobChunk(env, { linkedServerId, jobId });
  await recordAdmImportJobProgressInSyncState(env, await getAdmImportJob(env, linkedServerId, jobId) ?? progressToImportJobRow(progress, linkedServerId), isCompletedAdmImportJobStatus(progress.status) ? "completed" : "processing_in_chunks");
  for (let index = 1; index < safeMaxChunks && !isCompletedAdmImportJobStatus(progress.status); index += 1) {
    if (Date.now() >= deadlineMs) break;
    progress = await processNextAdmImportJobChunk(env, { linkedServerId, jobId });
    await recordAdmImportJobProgressInSyncState(env, await getAdmImportJob(env, linkedServerId, jobId) ?? progressToImportJobRow(progress, linkedServerId), isCompletedAdmImportJobStatus(progress.status) ? "completed" : "processing_in_chunks");
  }
  return progress;
}

async function writeAdmImportChunk(
  env: Env,
  input: {
    context: AdmSyncContext;
    allLines?: string[];
    chunkLines?: string[];
    previousLines?: string[];
    startLine: number;
    endLine?: number;
    includeHitLines?: boolean;
    triggerType: string;
  },
): Promise<AdmChunkWriteResult> {
  const chunkLines = input.chunkLines ?? input.allLines?.slice(input.startLine, input.endLine ?? input.startLine) ?? [];
  const parsedLines = parseAdmLines(chunkLines, { admDate: extractAdmDateFromFile(input.context.admFileName) ?? undefined });
  const reportCursorStart = input.chunkLines ? 0 : input.startLine;
  const reportCursorEnd = input.chunkLines ? chunkLines.length : input.endLine ?? input.startLine + chunkLines.length;
  const chunkReport = buildAdmImportDebugReport(chunkLines, {
    admFileName: input.context.admFileName,
    cursorStart: reportCursorStart,
    cursorEnd: reportCursorEnd,
  });
  const recentDeathLines = input.previousLines
    ? seedRecentDeathContextFromPreviousLines(input.previousLines, input.context.admFileName, input.startLine)
    : seedRecentDeathContext(input.allLines ?? [], input.context.admFileName, input.startLine);
  const parserWarnings = buildParserWarnings(chunkReport);
  const includeHitLines = input.includeHitLines === true;
  let rawEventsStored = 0;
  let playerEventsStored = 0;
  let buildEventsStored = 0;
  let writtenKills = 0;
  let duplicateSkips = 0;
  let eventsCreated = 0;
  let deaths = 0;
  let joins = 0;
  let disconnects = 0;
  let lastEventAt: string | null = null;

  for (let index = 0; index < parsedLines.length; index += 1) {
    const parsed = parsedLines[index];
    const lineNumber = input.startLine + index + 1;
    if (!includeHitLines && isHitEvent(parsed)) {
      continue;
    }
    const rawInserted = await insertRawEvent(env, input.context, lineNumber, parsed.rawLine, parsed);
    if (rawInserted) {
      rawEventsStored += 1;
    } else {
      duplicateSkips += 1;
    }

    const eventResult = await persistParsedEvent(env, input.context, lineNumber, parsed, { recentDeathLines });
    const eventWrites = eventResult.playerEventsCreated + eventResult.killEventsCreated + eventResult.buildEventsCreated;
    if (eventWrites === 0 && parsed.eventType !== "admin_log_started" && parsed.eventType !== "playerlist_snapshot" && parsed.eventType !== "playerlist_delimiter" && parsed.eventType !== "unknown") {
      duplicateSkips += 1;
    }
    playerEventsStored += eventResult.playerEventsCreated;
    buildEventsStored += eventResult.buildEventsCreated;
    writtenKills += eventResult.killEventsCreated;
    eventsCreated += eventResult.eventsCreated;
    deaths += eventResult.deathsCreated;
    joins += eventResult.joinsCreated;
    disconnects += eventResult.disconnectsCreated;
    if (eventResult.eventsCreated > 0) lastEventAt = parsed.occurredAt ?? new Date().toISOString();
  }

  return {
    rawLines: chunkLines.length,
    rawKilledByLinesFound: chunkReport.rawKilledByLinesFound,
    parsedKills: chunkReport.parsedPvpKills,
    writtenKills,
    deaths,
    joins,
    disconnects,
    playerlistSnapshots: chunkReport.parsedPlayerlistSnapshots,
    suicides: chunkReport.parsedSuicides,
    uncreditedDeaths: chunkReport.parsedUncreditedDeaths,
    hitLines: chunkReport.parsedHitLines,
    rawEventsStored,
    playerEventsStored,
    buildEventsStored,
    duplicateSkips,
    failedWrites: 0,
    eventsCreated,
    lastEventAt,
    parserWarnings,
  };
}

function seedRecentDeathContext(lines: string[], filename: string | null, startLine: number) {
  const recentDeathLines = new Map<string, number>();
  const overlapStart = Math.max(0, startLine - 5);
  if (overlapStart >= startLine) return recentDeathLines;
  const previous = parseAdmLines(lines.slice(overlapStart, startLine), { admDate: extractAdmDateFromFile(filename) ?? undefined });
  for (let index = 0; index < previous.length; index += 1) {
    const parsed = previous[index];
    if (isDeathCountingEvent(parsed)) markDeathCounted(recentDeathLines, parsed, overlapStart + index + 1);
  }
  return recentDeathLines;
}

function seedRecentDeathContextFromPreviousLines(lines: string[], filename: string | null, nextStartLine: number) {
  const recentDeathLines = new Map<string, number>();
  if (!lines.length) return recentDeathLines;
  const startLine = Math.max(0, nextStartLine - lines.length);
  const previous = parseAdmLines(lines, { admDate: extractAdmDateFromFile(filename) ?? undefined });
  for (let index = 0; index < previous.length; index += 1) {
    const parsed = previous[index];
    if (isDeathCountingEvent(parsed)) markDeathCounted(recentDeathLines, parsed, startLine + index + 1);
  }
  return recentDeathLines;
}

async function finalizeAdmImportJob(
  env: Env,
  server: ManualImportLinkedServer,
  row: AdmImportJobRow,
  lines: string[] | null,
): Promise<AdmImportJobProgressResult> {
  const existing = await getAdmImportJob(env, row.server_id, row.id);
  if (existing && isCompletedAdmImportJobStatus(existing.status)) return toAdmImportJobProgress(existing);

  const now = new Date().toISOString();
  const db = requireDb(env);
  await db
    .prepare("UPDATE adm_import_jobs SET status = 'rebuilding', updated_at = ? WHERE id = ? AND server_id = ?")
    .bind(now, row.id, row.server_id)
    .run();

  let publicCacheUpdated = false;
  let cacheRefreshStatus: AdmDatabaseImportReport["cacheRefreshStatus"] = "skipped";
  let discordQueuesCreated = 0;
  let discordQueueStatus: AdmDatabaseImportReport["discordQueueStatus"] = "skipped";
  const warnings = parseJobWarnings(row);
  const initialWarningCount = warnings.length;
  const totalLines = Number(row.total_lines ?? 0);
  const chunkStats = getNormalizedAdmJobChunkStats(row);
  const isScheduledNitradoImport = row.source === SCHEDULED_ADM_IMPORT_SOURCE;
  const importRoute = isScheduledNitradoImport ? "scheduled_chunked_import" : "manual_chunked_import";
  const importMessagePrefix = isScheduledNitradoImport ? "Scheduled ADM import" : "Manual ADM import";
  const importCursorReason = isScheduledNitradoImport ? "scheduled_chunked_import" : "manual_chunked_import";

  try {
    await rebuildServerStats(env, row.server_id);
    await rebuildServerBuildStats(env, row.server_id);
  } catch (error) {
    warnings.push(`${row.filename}: Stats rebuild failed after ADM rows were written. ${safeSyncErrorMessage(error)}`);
  }

  if (server.guild_id) {
    try {
      await withManualAdmPhaseTimeout(upsertServerPublicCache(env, {
        guildId: server.guild_id,
        planKey: server.plan_key,
        publicServerName: firstString(server.display_name, server.hostname, server.server_name, server.nitrado_service_name),
        lastAdmUpdateAt: now,
      }), "public cache update");
      publicCacheUpdated = true;
      cacheRefreshStatus = "updated";
    } catch (error) {
      cacheRefreshStatus = "failed";
      warnings.push(`${row.filename}: Public cache update failed after ADM rows were written. ${safeSyncErrorMessage(error)}`);
    }
  }

  if (server.guild_id && isActiveSubscriptionStatus(server.subscription_status) && (Number(row.written_kills ?? 0) > 0 || Number(row.player_events ?? 0) > 0 || Number(row.raw_events ?? 0) > 0)) {
    try {
      discordQueuesCreated = await withManualAdmPhaseTimeout(queueDiscordPostUpdatesForGuild(env, server.guild_id, server.plan_key, [
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
      ], "manual-adm-import"), "Discord post queue");
      discordQueueStatus = discordQueuesCreated > 0 ? "queued" : "skipped";
    } catch (error) {
      discordQueueStatus = "failed";
      warnings.push(`${row.filename}: Discord auto-post queueing failed after ADM rows were written. ${safeSyncErrorMessage(error)}`);
    }
  }

  const fullReport = lines
    ? buildAdmImportDebugReport(lines, {
      admFileName: row.filename,
      cursorStart: 0,
      cursorEnd: lines.length,
    })
    : {
      admFileName: row.filename,
      cursorStart: 0,
      cursorEnd: totalLines,
      rawKilledByLinesFound: Number(row.raw_kill_lines_found ?? row.parsed_kills ?? 0),
      parsedPvpKills: Number(row.parsed_kills ?? 0),
      parsedJoins: Number(row.joins ?? 0),
      parsedDisconnects: Number(row.disconnects ?? 0),
      parsedPlayerlistSnapshots: Number(row.playerlist_snapshots ?? 0),
      parsedHitLines: Number(row.hit_lines ?? 0),
      skippedDeadHitLines: 0,
      parsedSuicides: Number(row.suicides ?? 0),
      parsedUncreditedDeaths: Number(row.uncredited_deaths ?? 0),
      duplicateSkips: Number(row.duplicate_skips ?? 0),
      pvpKillLineNumbers: [],
    };
  const report: AdmDatabaseImportReport = {
    ...fullReport,
    importSource: row.source,
    importedAt: now,
    importReportId: row.id,
    parserWarnings: warnings,
    attemptedDbWrites: Number(row.raw_events ?? 0) + Number(row.player_events ?? 0) + Number(row.written_kills ?? 0),
    successfulDbWrites: Number(row.raw_events ?? 0) + Number(row.player_events ?? 0) + Number(row.written_kills ?? 0),
    writtenKills: Number(row.written_kills ?? 0),
    failedWrites: Number(row.failed_writes ?? 0),
    cursorBefore: 0,
    cursorAfter: totalLines,
    cursorAdvanced: true,
    publicCacheUpdated,
    discordQueuesCreated,
    cacheRefreshStatus,
    discordQueueStatus,
    cursorValidationStatus: "new_file",
    cursorValidationError: null,
    cursorRecoveryStrategy: null,
    cursorRecoveryReason: "manual_chunked_import",
    previousLineHash: null,
    currentLineHash: null,
    cursorLineChecked: null,
    cursorHashMatched: null,
    duplicateSkips: Number(row.duplicate_skips ?? 0),
  };
  const cursorSnapshot = lines
    ? await buildProcessedCursorSnapshot(lines, lines.length)
    : { hash: null, preview: null };
  try {
    await upsertSyncState(env, row.server_id, {
      latestAdmFile: row.filename,
      latestAdmPath: row.filename,
      sourceServiceId: server.nitrado_service_id ?? row.source_service_id ?? "manual-adm-import",
      lastProcessedFile: row.filename,
      lastProcessedLine: totalLines,
      lastProcessedOffset: lines ? calculateAdmLineOffset(lines, lines.length) : totalLines,
      status: "completed",
      message: `${importMessagePrefix} completed in ${row.total_chunks} chunk${Number(row.total_chunks) === 1 ? "" : "s"}. Kill events inserted: ${row.written_kills}.`,
      lastSyncAt: now,
      linesRead: totalLines,
      linesProcessed: totalLines,
      rawEventsStored: Number(row.raw_events ?? 0),
      playerEventsStored: Number(row.player_events ?? 0),
      killEventsStored: Number(row.written_kills ?? 0),
      eventsCreated: Number(row.player_events ?? 0) + Number(row.written_kills ?? 0),
      killsCreated: Number(row.written_kills ?? 0),
      unknownLines: 0,
      duplicateLines: Number(row.duplicate_skips ?? 0),
      syncDurationMs: 0,
      readableRoute: importRoute,
      rawKillLinesFound: fullReport.rawKilledByLinesFound,
      parsedKillLinesFound: fullReport.parsedPvpKills,
      parserSkippedLines: fullReport.skippedDeadHitLines,
      unreadableFilesQueued: 0,
      newestUnprocessedAdmFile: null,
      importReportJson: JSON.stringify(report),
      lastProcessedAdmLineHash: cursorSnapshot.hash,
      lastProcessedAdmLineTextPreview: cursorSnapshot.preview,
      lastCursorValidationStatus: "new_file",
      lastCursorValidationError: null,
      lastCursorValidationAt: now,
      cursorRecoveryStrategy: null,
      cursorRecoveryReason: importCursorReason,
    });
    await recordAdmFileAttempt(env, withAdmFile(verifyAdmServerScope(server, row.id), row.filename), {
      name: row.filename,
      path: row.filename,
      timestamp: extractAdmTimestampScore(row.filename),
    }, {
      status: "processed",
      lineCount: totalLines,
      rawKillLinesFound: fullReport.rawKilledByLinesFound,
      parsedKillLinesFound: fullReport.parsedPvpKills,
      insertedKills: Number(row.written_kills ?? 0),
      parserSkippedLines: fullReport.skippedDeadHitLines,
      lastLineProcessed: totalLines,
      message: null,
    });
  } catch (error) {
    warnings.push(`${row.filename}: Last ADM Import Report could not be saved after ADM rows were written. ${safeSyncErrorMessage(error)}`);
  }

  const syncRunMessage = buildAdmImportSyncRunMessage({
    source: row.source,
    filename: row.filename,
    rawLines: totalLines,
    parsedKills: fullReport.parsedPvpKills,
    writtenKills: Number(row.written_kills ?? 0),
    joins: Number(row.joins ?? 0),
    disconnects: Number(row.disconnects ?? 0),
    playerlistSnapshots: Number(row.playerlist_snapshots ?? 0),
    duplicateSkips: Number(row.duplicate_skips ?? 0),
    failedWrites: Number(row.failed_writes ?? 0),
    importedAt: now,
  });
  try {
    await recordSyncRun(env, {
      id: row.id,
      linkedServerId: row.server_id,
      sourceServiceId: server.nitrado_service_id,
      triggerType: row.source,
      status: "completed",
      message: syncRunMessage,
      linesRead: totalLines,
      linesProcessed: totalLines,
      eventsCreated: Number(row.player_events ?? 0) + Number(row.written_kills ?? 0),
      killsCreated: Number(row.written_kills ?? 0),
      startedAt: row.created_at ?? now,
      finishedAt: now,
      durationMs: row.created_at ? Math.max(0, Date.parse(now) - Date.parse(row.created_at)) : 0,
    });
  } catch (error) {
    warnings.push(`${row.filename}: Import history row could not be saved after ADM rows were written. ${safeSyncErrorMessage(error)}`);
  }

  const hasSkippedFailedLineWarning = warnings.some((warning) => /skipped line \d+ after parser\/write failure/i.test(warning));
  const hasFinishWarnings = warnings.length > initialWarningCount;
  const finalStatus: AdmImportJobProgressResult["status"] = hasFinishWarnings || hasSkippedFailedLineWarning ? "completed_with_warnings" : "completed";
  const fileStatus: ManualAdmBulkFileResult["status"] =
    finalStatus === "completed_with_warnings" ? "completed_with_warnings" :
      Number(row.written_kills ?? 0) === 0 && Number(row.duplicate_skips ?? 0) > 0 && Number(row.failed_writes ?? 0) === 0 ? "completed_duplicate_only" :
        "imported";

  const fileResult: ManualAdmBulkFileResult = {
    ok: true,
    filename: row.filename,
    source: row.source,
    status: fileStatus,
    job_id: row.id,
    job_status: finalStatus,
    chunks_processed: chunkStats.totalChunks,
    total_chunks: chunkStats.totalChunks,
    raw_lines: totalLines,
    raw_kill_lines_found: fullReport.rawKilledByLinesFound,
    parsed_kills: fullReport.parsedPvpKills,
    written_kills: Number(row.written_kills ?? 0),
    deaths: Number(row.written_kills ?? 0) + fullReport.parsedSuicides + fullReport.parsedUncreditedDeaths,
    joins: Number(row.joins ?? 0),
    disconnects: Number(row.disconnects ?? 0),
    playerlist_snapshots: fullReport.parsedPlayerlistSnapshots,
    suicides: fullReport.parsedSuicides,
    uncredited_deaths: fullReport.parsedUncreditedDeaths,
    hit_lines: fullReport.parsedHitLines,
    raw_events_stored: Number(row.raw_events ?? 0),
    player_events_stored: Number(row.player_events ?? 0),
    duplicate_skips: Number(row.duplicate_skips ?? 0),
    failed_writes: Number(row.failed_writes ?? 0),
    public_cache_updated: publicCacheUpdated,
    discord_jobs_queued: discordQueuesCreated,
    parser_warnings: warnings,
    kill_previews: lines ? buildKillPreviews(lines, row.filename, 5) : [],
    import_report_id: row.id,
    imported_at: now,
  };

  await db
    .prepare(
      `UPDATE adm_import_jobs SET
        status = ?,
        current_line = total_lines,
        total_chunks = ?,
        chunks_processed = ?,
        public_cache_updated = ?,
        discord_jobs_queued = ?,
        warnings_json = ?,
        result_json = ?,
        completed_at = ?,
        updated_at = ?
       WHERE id = ? AND server_id = ?`,
    )
    .bind(finalStatus, chunkStats.totalChunks, chunkStats.totalChunks, publicCacheUpdated ? 1 : 0, discordQueuesCreated, JSON.stringify(warnings), JSON.stringify(fileResult), now, now, row.id, row.server_id)
    .run();

  const completed = await getAdmImportJob(env, row.server_id, row.id);
  return toAdmImportJobProgress(completed ?? { ...row, status: finalStatus, result_json: JSON.stringify(fileResult), completed_at: now });
}

async function getAdmImportJob(env: Env, linkedServerId: string, jobId: string) {
  const db = requireDb(env);
  return await db
    .prepare("SELECT * FROM adm_import_jobs WHERE id = ? AND server_id = ? LIMIT 1")
    .bind(jobId, linkedServerId)
    .first<AdmImportJobRow>();
}

export async function getAdmImportJobProgressForServer(
  env: Env,
  input: {
    linkedServerId: string;
    jobId: string;
  },
): Promise<AdmImportJobProgressResult | null> {
  await ensureAdmSyncSchema(env);
  const row = await getAdmImportJob(env, input.linkedServerId, input.jobId);
  return row ? toAdmImportJobProgress(row) : null;
}

export async function getLatestAdmImportJobProgressForFilename(
  env: Env,
  input: {
    linkedServerId: string;
    filename: string;
  },
): Promise<AdmImportJobProgressResult | null> {
  await ensureAdmSyncSchema(env);
  const filename = sanitizeManualAdmFilename(input.filename);
  if (!filename) return null;
  const row = await getAdmImportJobForFilename(env, input.linkedServerId, filename);
  return row ? toAdmImportJobProgress(row) : null;
}

async function getAdmImportJobForFilename(env: Env, linkedServerId: string, filename: string) {
  return await requireDb(env)
    .prepare(
      `SELECT * FROM adm_import_jobs
       WHERE server_id = ? AND filename = ?
       ORDER BY
         CASE WHEN status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable') THEN 0 WHEN status IN ('completed', 'completed_with_warnings') THEN 1 ELSE 2 END,
         updated_at DESC,
         created_at DESC
       LIMIT 1`,
    )
    .bind(linkedServerId, filename)
    .first<AdmImportJobRow>();
}

async function getAdmImportJobsForServer(env: Env, linkedServerId: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT * FROM adm_import_jobs
       WHERE server_id = ?
       ORDER BY created_at ASC, updated_at ASC`,
    )
    .bind(linkedServerId)
    .all<AdmImportJobRow>();
  return rows.results ?? [];
}

async function getActiveAdmImportJob(env: Env, linkedServerId: string) {
  return await requireDb(env)
    .prepare(
      `SELECT * FROM adm_import_jobs
       WHERE server_id = ?
         AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable')
       ORDER BY
         CASE WHEN status IN ('processing', 'parsing', 'writing', 'rebuilding') THEN 0 ELSE 1 END,
         created_at ASC,
         updated_at ASC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<AdmImportJobRow>();
}

async function getHandledAdmFilenames(env: Env, linkedServerId: string, sourceServiceId: string) {
  const db = requireDb(env);
  const [fileStateRows, killRows, playerRows, rawRows] = await Promise.all([
    db
      .prepare(
        `SELECT adm_file AS filename
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
           AND source_service_id = ?
           AND status = 'processed'
           AND ignored_at IS NULL`,
      )
      .bind(linkedServerId, sourceServiceId)
      .all<{ filename: string | null }>()
      .catch(() => ({ results: [] as Array<{ filename: string | null }> })),
    db
      .prepare(
        `SELECT DISTINCT COALESCE(source_adm_file, adm_file) AS filename
         FROM kill_events
         WHERE linked_server_id = ?
           AND COALESCE(source_adm_file, adm_file, '') != ''`,
      )
      .bind(linkedServerId)
      .all<{ filename: string | null }>()
      .catch(() => ({ results: [] as Array<{ filename: string | null }> })),
    db
      .prepare(
        `SELECT DISTINCT COALESCE(source_adm_file, adm_file) AS filename
         FROM player_events
         WHERE linked_server_id = ?
           AND COALESCE(source_adm_file, adm_file, '') != ''`,
      )
      .bind(linkedServerId)
      .all<{ filename: string | null }>()
      .catch(() => ({ results: [] as Array<{ filename: string | null }> })),
    db
      .prepare(
        `SELECT DISTINCT COALESCE(source_adm_file, adm_file) AS filename
         FROM adm_raw_events
         WHERE linked_server_id = ?
           AND COALESCE(source_adm_file, adm_file, '') != ''`,
      )
      .bind(linkedServerId)
      .all<{ filename: string | null }>()
      .catch(() => ({ results: [] as Array<{ filename: string | null }> })),
  ]);
  return [
    ...(fileStateRows.results ?? []),
    ...(killRows.results ?? []),
    ...(playerRows.results ?? []),
    ...(rawRows.results ?? []),
  ]
    .map((row) => row.filename)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function findReadErrorForAdmFile(readErrors: string[], filename: string) {
  const key = normalizeAdmFilenameKey(filename);
  return readErrors.find((error) => normalizeAdmFilenameKey(error.split(":")[0]) === key) ?? null;
}

async function recordAdmImportJobProgressInSyncState(
  env: Env,
  row: AdmImportJobRow,
  status: AdmSyncStatusCode | "failed_retryable" = "processing_in_chunks",
  message?: string,
) {
  const now = new Date().toISOString();
  const progressStatus = status === "failed_retryable" ? "processing_in_chunks" : status;
  const rowCompleted = row.status === "completed" || row.status === "completed_with_warnings";
  const existingState = await getSyncState(env, row.server_id).catch(() => null);
  const latestAdmFile = existingState?.latest_adm_file && compareAdmFileNamesChronological(existingState.latest_adm_file, row.filename) >= 0
    ? existingState.latest_adm_file
    : row.filename;
  const latestAdmPath = latestAdmFile === row.filename
    ? row.filename
    : existingState?.latest_adm_path ?? row.filename;
  const lastProcessedFile = rowCompleted ? row.filename : existingState?.last_processed_file ?? null;
  const lastProcessedLine = rowCompleted ? Number(row.current_line ?? row.total_lines ?? 0) : Number(existingState?.last_processed_line ?? 0);
  const lastProcessedOffset = rowCompleted ? Number(row.current_line ?? row.total_lines ?? 0) : Number(existingState?.last_processed_offset ?? 0);
  const progressMessage = message ?? (rowCompleted
    ? `ADM chunk import completed for ${row.filename}.`
    : `Processing latest ADM in chunks. File: ${row.filename}. Progress: chunk ${Math.min(Number(row.chunks_processed ?? 0) + 1, Number(row.total_chunks ?? 1))}/${Number(row.total_chunks ?? 1)}. Parsed kills so far: ${Number(row.parsed_kills ?? 0)}. Written kills so far: ${Number(row.written_kills ?? 0)}. Duplicates skipped: ${Number(row.duplicate_skips ?? 0)}. Next chunk on next cron tick.`);
  await upsertSyncState(env, row.server_id, {
    latestAdmFile,
    latestAdmPath,
    sourceServiceId: row.source_service_id ?? "scheduled-nitrado",
    lastProcessedFile,
    lastProcessedLine,
    lastProcessedOffset,
    status: progressStatus,
    message: progressMessage,
    lastSyncAt: now,
    linesRead: Number(row.total_lines ?? 0),
    linesProcessed: Number(row.current_line ?? 0),
    rawEventsStored: Number(row.raw_events ?? 0),
    playerEventsStored: Number(row.player_events ?? 0),
    killEventsStored: Number(row.written_kills ?? 0),
    eventsCreated: Number(row.player_events ?? 0) + Number(row.written_kills ?? 0),
    killsCreated: Number(row.written_kills ?? 0),
    unknownLines: 0,
    duplicateLines: Number(row.duplicate_skips ?? 0),
    syncDurationMs: 0,
    readableRoute: row.source === SCHEDULED_ADM_IMPORT_SOURCE ? "scheduled_chunked_import" : "manual_chunked_import",
    rawKillLinesFound: Number(row.raw_kill_lines_found ?? 0),
    parsedKillLinesFound: Number(row.parsed_kills ?? 0),
    parserSkippedLines: 0,
    unreadableFilesQueued: 0,
    newestUnprocessedAdmFile: rowCompleted ? null : row.filename,
    lastCursorValidationStatus: existingState?.last_cursor_validation_status ?? (rowCompleted ? "new_file" : null),
    lastCursorValidationError: existingState?.last_cursor_validation_error ?? null,
    lastCursorValidationAt: existingState?.last_cursor_validation_at ?? null,
    cursorRecoveryStrategy: existingState?.cursor_recovery_strategy ?? null,
    cursorRecoveryReason: existingState?.cursor_recovery_reason ?? (rowCompleted
      ? row.source === SCHEDULED_ADM_IMPORT_SOURCE ? "scheduled_chunked_import" : "manual_chunked_import"
      : null),
  });
}

function progressToImportJobRow(progress: AdmImportJobProgressResult, linkedServerId: string): AdmImportJobRow {
  return {
    id: progress.job_id,
    server_id: linkedServerId,
    source_service_id: null,
    filename: progress.filename,
    source: progress.source,
    status: progress.status,
    adm_text: "",
    total_lines: progress.total_lines,
    current_line: progress.current_line,
    chunk_size: progress.chunk_size,
    total_chunks: progress.total_chunks,
    chunks_processed: progress.chunks_processed,
    import_hit_lines: progress.import_hit_lines ? 1 : 0,
    raw_kill_lines_found: 0,
    last_chunk_index: progress.last_chunk_index ?? null,
    failed_chunk_index: progress.failed_chunk_index ?? null,
    parsed_kills: progress.parsed_kills,
    written_kills: progress.written_kills,
    duplicate_skips: progress.duplicate_skips,
    joins: progress.joins,
    disconnects: progress.disconnects,
    playerlist_snapshots: progress.playerlist_snapshots,
    deaths: 0,
    suicides: 0,
    uncredited_deaths: 0,
    hit_lines: progress.hit_lines,
    raw_events: progress.raw_events_stored,
    player_events: progress.player_events_stored,
    failed_writes: 0,
    public_cache_updated: progress.public_cache_updated ? 1 : 0,
    discord_jobs_queued: progress.discord_jobs_queued,
    warnings_json: JSON.stringify(progress.warnings),
    error_message: null,
    result_json: progress.file_result ? JSON.stringify(progress.file_result) : null,
    created_at: null,
    updated_at: null,
    completed_at: isCompletedAdmImportJobStatus(progress.status) ? new Date().toISOString() : null,
  };
}

function scheduledJobResultFromProgress(
  progress: AdmImportJobProgressResult,
  duplicateExistingJob: boolean,
  latestAdmFile: string,
  newestAvailable: DiscoveredAdmFileForSync | null,
  overrideStatus?: AdmSyncStatusCode,
): ScheduledAdmImportJobResult {
  const completed = isCompletedAdmImportJobStatus(progress.status);
  const status = overrideStatus ?? (completed ? "completed" : "processing_in_chunks");
  return {
    ok: true,
    status,
    message: completed
      ? `Scheduled ADM chunk import completed for ${latestAdmFile}.`
      : status === "adm_import_job_queued"
        ? `Queued scheduled ADM chunk import for ${latestAdmFile}.`
      : `Processing latest ADM in chunks: ${progress.chunks_processed}/${progress.total_chunks}.`,
    job: progress,
    duplicateExistingJob,
    latestAdmFile,
    latestAdmTimestamp: timestampIso(extractAdmTimestampScore(latestAdmFile)),
    newestAvailableAdmFile: newestAvailable?.name ?? latestAdmFile,
    newestAvailableAdmTimestamp: timestampIso(newestAvailable?.timestamp ?? extractAdmTimestampScore(latestAdmFile)),
    newestReadableAdmFile: latestAdmFile,
    newestReadableAdmTimestamp: timestampIso(extractAdmTimestampScore(latestAdmFile)),
  };
}

async function recoverStaleAdmImportJobs(env: Env, source: string) {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await requireDb(env)
    .prepare(
      `UPDATE adm_import_jobs SET
        status = 'failed_retryable',
        error_message = COALESCE(error_message, 'Scheduled ADM import job stalled for more than 10 minutes. Worker cron will retry it automatically.'),
        updated_at = ?
       WHERE source = ?
         AND status IN ('processing', 'parsing', 'writing', 'rebuilding')
         AND COALESCE(updated_at, created_at) < ?`,
    )
    .bind(now, source, cutoff)
    .run();
}

function getCompletedAdmCursorFile(state: AdmSyncState | null) {
  const status = String(state?.last_sync_status ?? "").toLowerCase();
  if (!["completed", "completed_with_warnings", "new_data_found", "no_new_lines", "no_new_log_available", "no_supported_events"].includes(status)) {
    return null;
  }
  return state?.last_processed_file ?? state?.latest_adm_file ?? null;
}

export function isAdmFileNewerThan(candidate: string | null | undefined, completed: string | null | undefined) {
  if (!candidate) return false;
  if (!completed) return true;
  return compareAdmFileNamesChronological(candidate, completed) > 0;
}

function findReadableAdmFileByName(files: ReadableAdmFileForSync[], name: string | null) {
  if (!name) return null;
  return files.find((file) => file.name.toLowerCase() === name.toLowerCase()) ?? null;
}

function parseJobWarnings(row: Pick<AdmImportJobRow, "warnings_json">) {
  try {
    const parsed = row.warnings_json ? JSON.parse(row.warnings_json) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function toAdmImportJobProgress(row: AdmImportJobRow): AdmImportJobProgressResult {
  const fileResult = parseJobFileResult(row.result_json);
  const chunkStats = getNormalizedAdmJobChunkStats(row);
  const warnings = parseJobWarnings(row);
  const chunkWarnings = chunkStats.chunkCountMismatch
    ? [`${row.filename}: chunk_count_mismatch corrected for display. Stored ${chunkStats.storedTotalChunks}, calculated ${chunkStats.calculatedTotalChunks}, processed ${chunkStats.rawChunksProcessed}.`]
    : [];
  return {
    ok: true,
    job_id: row.id,
    filename: row.filename,
    source: row.source,
    status: normalizeImportJobStatus(row.status),
    total_lines: chunkStats.totalLines,
    current_line: chunkStats.currentLine,
    chunk_size: chunkStats.chunkSize,
    total_chunks: chunkStats.totalChunks,
    chunks_processed: chunkStats.chunksProcessed,
    display_current_chunk: chunkStats.displayCurrentChunk,
    chunk_count_mismatch: chunkStats.chunkCountMismatch,
    import_hit_lines: Number(row.import_hit_lines ?? 0) === 1,
    last_chunk_index: row.last_chunk_index === null || row.last_chunk_index === undefined ? null : Number(row.last_chunk_index),
    failed_chunk_index: row.failed_chunk_index === null || row.failed_chunk_index === undefined ? null : Number(row.failed_chunk_index),
    progress: chunkStats.totalLines > 0 ? Math.max(0, Math.min(1, chunkStats.currentLine / chunkStats.totalLines)) : 0,
    parsed_kills: Number(row.parsed_kills ?? 0),
    written_kills: Number(row.written_kills ?? 0),
    duplicate_skips: Number(row.duplicate_skips ?? 0),
    joins: Number(row.joins ?? 0),
    disconnects: Number(row.disconnects ?? 0),
    playerlist_snapshots: Number(row.playerlist_snapshots ?? 0),
    hit_lines: Number(row.hit_lines ?? 0),
    raw_events_stored: Number(row.raw_events ?? 0),
    player_events_stored: Number(row.player_events ?? 0),
    public_cache_updated: Boolean(Number(row.public_cache_updated ?? 0)),
    discord_jobs_queued: Number(row.discord_jobs_queued ?? 0),
    warnings: [...warnings, ...chunkWarnings],
    file_result: fileResult,
    error_message: row.error_message ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    completed_at: row.completed_at ?? null,
  };
}

function getNormalizedAdmJobChunkStats(row: AdmImportJobRow) {
  const totalLines = Math.max(0, Number(row.total_lines ?? 0));
  const chunkSize = Math.max(1, Number(row.chunk_size ?? MANUAL_ADM_IMPORT_CHUNK_SIZE));
  const currentLine = Math.max(0, Math.min(totalLines, Number(row.current_line ?? 0)));
  const calculatedTotalChunks = Math.max(1, Math.ceil(Math.max(totalLines, 1) / chunkSize));
  const storedTotalChunks = Math.max(1, Number(row.total_chunks ?? 0));
  const rawChunksProcessed = Math.max(0, Number(row.chunks_processed ?? 0));
  const chunksFromLine = currentLine >= totalLines && totalLines > 0
    ? calculatedTotalChunks
    : Math.ceil(currentLine / chunkSize);
  const totalChunks = Math.max(storedTotalChunks, calculatedTotalChunks, rawChunksProcessed, chunksFromLine);
  const chunksProcessed = Math.max(0, Math.min(totalChunks, Math.max(rawChunksProcessed, chunksFromLine)));
  const displayCurrentChunk = currentLine >= totalLines && totalLines > 0
    ? totalChunks
    : Math.max(1, Math.min(totalChunks, chunksProcessed + 1));
  return {
    totalLines,
    chunkSize,
    currentLine,
    calculatedTotalChunks,
    storedTotalChunks,
    rawChunksProcessed,
    totalChunks,
    chunksProcessed,
    displayCurrentChunk,
    chunkCountMismatch: storedTotalChunks < calculatedTotalChunks || storedTotalChunks < rawChunksProcessed,
  };
}

function parseJobFileResult(value: string | null): ManualAdmBulkFileResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ManualAdmBulkFileResult;
    return parsed && typeof parsed === "object" && typeof parsed.filename === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeImportJobStatus(value: string): AdmImportJobProgressResult["status"] {
  if (value === "queued" || value === "processing" || value === "parsing" || value === "writing" || value === "rebuilding" || value === "completed" || value === "completed_with_warnings" || value === "failed" || value === "failed_retryable" || value === "cancelled") return value;
  return "queued";
}

function isCompletedAdmImportJobStatus(status: string) {
  return status === "completed" || status === "completed_with_warnings";
}

export function previewManualAdmText(input: {
  filename: string;
  admText: string;
}): ManualAdmParsePreviewResult {
  const filename = sanitizeManualAdmFilename(input.filename);
  if (!filename) throw new Error("A valid ADM filename is required.");
  const rawText = typeof input.admText === "string" ? input.admText : "";
  if (!rawText.trim()) throw new Error("ADM text is required.");
  const lines = splitAdmText(rawText);
  if (!lines.length) throw new Error("ADM text did not contain readable lines.");

  const report = buildAdmImportDebugReport(lines, {
    admFileName: filename,
    cursorStart: 0,
    cursorEnd: lines.length,
  });

  return {
    ok: true,
    filename,
    source: "manual_preview",
    raw_lines: lines.length,
    raw_kill_lines_found: report.rawKilledByLinesFound,
    parsed_kills: report.parsedPvpKills,
    joins: report.parsedJoins,
    disconnects: report.parsedDisconnects,
    playerlist_snapshots: report.parsedPlayerlistSnapshots,
    suicides: report.parsedSuicides,
    uncredited_deaths: report.parsedUncreditedDeaths,
    hit_lines: report.parsedHitLines,
    skipped_dead_hit_lines: report.skippedDeadHitLines,
    parser_warnings: buildParserWarnings(report),
    kill_previews: buildKillPreviews(lines, filename, 10),
  };
}

function buildKillPreviews(lines: string[], filename: string | null, limit: number): ManualAdmKillPreview[] {
  return parseAdmLines(lines, { admDate: extractAdmDateFromFile(filename) ?? undefined })
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.eventType === "player_killed" && event.isCreditedKill)
    .slice(0, limit)
    .map(({ event, index }) => ({
      line_number: index + 1,
      occurred_at: event.occurredAt,
      victim_name: event.victimName,
      killer_name: event.killerName,
      weapon: event.weapon,
      distance: event.distance,
      event_type: "pvp_kill" as const,
    }));
}

function normaliseBulkAdmFiles(files: ManualAdmBulkFileInput[]) {
  return files
    .map((file) => ({
      filename: sanitizeManualAdmFilename(file.filename) ?? "",
      admText: typeof file.admText === "string" ? file.admText : "",
    }))
    .filter((file) => file.filename && file.admText.trim())
    .sort((a, b) => compareAdmFileNamesChronological(a.filename, b.filename));
}

function summariseBulkAdmImportResults(
  mode: "preview" | "import",
  source: string,
  files: ManualAdmBulkFileResult[],
): ManualAdmBulkImportResult {
  const warnings = files.flatMap((file) => file.parser_warnings.map((warning) => `${file.filename}: ${warning}`));
  const errors = files
    .filter((file) => !file.ok)
    .map((file) => `${file.filename}: ${file.message ?? file.error_code ?? "failed"}`);
  return {
    ok: true,
    mode,
    source,
    files_uploaded: files.length,
    files_imported: files.filter((file) => file.ok && file.status !== "failed").length,
    failed_files: files.filter((file) => !file.ok || file.status === "failed").length,
    total_raw_lines: files.reduce((total, file) => total + file.raw_lines, 0),
    raw_kill_lines_found: files.reduce((total, file) => total + file.raw_kill_lines_found, 0),
    parsed_kills: files.reduce((total, file) => total + file.parsed_kills, 0),
    written_kills: files.reduce((total, file) => total + file.written_kills, 0),
    duplicate_kills_skipped: files.reduce((total, file) => total + file.duplicate_skips, 0),
    joins: files.reduce((total, file) => total + file.joins, 0),
    disconnects: files.reduce((total, file) => total + file.disconnects, 0),
    playerlist_snapshots: files.reduce((total, file) => total + file.playerlist_snapshots, 0),
    deaths: files.reduce((total, file) => total + file.deaths, 0),
    suicides: files.reduce((total, file) => total + file.suicides, 0),
    hit_lines: files.reduce((total, file) => total + file.hit_lines, 0),
    raw_events_stored: files.reduce((total, file) => total + file.raw_events_stored, 0),
    player_events_stored: files.reduce((total, file) => total + file.player_events_stored, 0),
    public_cache_updated: files.some((file) => file.public_cache_updated),
    discord_jobs_queued: files.reduce((total, file) => total + file.discord_jobs_queued, 0),
    warnings,
    errors,
    files,
  };
}

async function withManualAdmPhaseTimeout<T>(promise: Promise<T>, phase: string, timeoutMs = 8000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${phase} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
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

function isHitEvent(event: ParsedAdmEvent) {
  return event.eventType === "player_hit" ||
    event.eventType === "player_hit_explosion" ||
    event.eventType === "player_hit_unknown_attacker";
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

async function getAdmBackfillStatus(env: Env, linkedServerId: string): Promise<AdmBackfillStatus> {
  const db = requireDb(env);
  const todayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const [activeJobRow, queuedRows, missingRows, completedToday, skippedAlreadyImported] = await Promise.all([
    getActiveAdmImportJob(env, linkedServerId),
    db
      .prepare(
        `SELECT filename
         FROM adm_import_jobs
         WHERE server_id = ?
           AND source = ?
           AND status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable')
         ORDER BY created_at ASC`,
      )
      .bind(linkedServerId, SCHEDULED_ADM_IMPORT_SOURCE)
      .all<{ filename: string }>()
      .catch(() => ({ results: [] as Array<{ filename: string }> })),
    db
      .prepare(
        `SELECT adm_file, status
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
           AND ignored_at IS NULL
           AND status IN ('discovered', 'unreadable', 'parser_error', 'write_error', 'partial')
         ORDER BY adm_file ASC`,
      )
      .bind(linkedServerId)
      .all<{ adm_file: string; status: string }>()
      .catch(() => ({ results: [] as Array<{ adm_file: string; status: string }> })),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM adm_import_jobs
         WHERE server_id = ?
           AND source = ?
           AND status IN ('completed', 'completed_with_warnings')
           AND COALESCE(completed_at, updated_at, created_at) >= ?`,
      )
      .bind(linkedServerId, SCHEDULED_ADM_IMPORT_SOURCE, todayStart)
      .first<{ count: number | null }>()
      .catch(() => ({ count: 0 })),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM adm_sync_file_state
         WHERE linked_server_id = ?
           AND ignored_at IS NULL
           AND status = 'processed'`,
      )
      .bind(linkedServerId)
      .first<{ count: number | null }>()
      .catch(() => ({ count: 0 })),
  ]);
  const activeJob = activeJobRow ? toAdmImportJobProgress(activeJobRow) : null;
  const queuedFiles = (queuedRows.results ?? []).map((row) => row.filename).filter(Boolean);
  const missingFiles = (missingRows.results ?? []).map((row) => row.adm_file).filter(Boolean);
  const unreadableFiles = (missingRows.results ?? []).filter((row) => row.status === "unreadable").map((row) => row.adm_file).filter(Boolean);
  const nextAction = activeJob
    ? `Processing ${activeJob.filename} chunk ${Math.min(activeJob.total_chunks, activeJob.chunks_processed + 1)}/${activeJob.total_chunks}.`
    : queuedFiles.length
      ? `Start queued backfill file ${queuedFiles[0]} on the next cron tick.`
      : missingFiles.length
        ? "Retry unreadable or partial ADM files and queue readable backfill files."
        : "ADM backfill is caught up.";

  return {
    missing_files_detected: missingFiles.length,
    queued_files: queuedFiles,
    active_file: activeJob?.filename ?? null,
    active_job: activeJob,
    completed_files_today: numberOrZero(completedToday?.count),
    skipped_already_imported: numberOrZero(skippedAlreadyImported?.count),
    oldest_missing_file: missingFiles[0] ?? null,
    newest_missing_file: missingFiles.at(-1) ?? null,
    unreadable_files: unreadableFiles,
    next_action: nextAction,
    last_planned_at: new Date().toISOString(),
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
  const [recentRuns, lastManualRun, lastScheduledRun, lastSuccessfulRun, unreadableQueued, newestUnprocessed, activeImportJobRow, admBackfillStatus] = await Promise.all([
    getRecentSyncRuns(env, linkedServer.id, 5),
    getLatestSyncRunByTrigger(env, linkedServer.id, "manual"),
    getLatestSyncRunByTrigger(env, linkedServer.id, "scheduled"),
    getLatestSuccessfulSyncRun(env, linkedServer.id),
    countQueuedUnreadableAdmFiles(env, linkedServer.id),
    getNewestUnprocessedAdmFile(env, linkedServer.id),
    getActiveAdmImportJob(env, linkedServer.id),
    getAdmBackfillStatus(env, linkedServer.id),
  ]);
  const manualImportHistory = await getManualAdmImportHistory(env, linkedServer.id, 5);
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
    active_adm_import_job: activeImportJobRow ? toAdmImportJobProgress(activeImportJobRow) : null,
    adm_backfill_status: admBackfillStatus,
    last_adm_import_report: parseAdmDatabaseImportReport(row?.last_import_report_json),
    current_recovery_action: getAdmRecoveryAction(currentStatus, unreadableQueued),
    recent_sync_runs: recentRuns,
    manual_import_history: manualImportHistory,
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
           0 AS event_priority,
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
           CASE
             WHEN event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats') THEN 1
             WHEN event_type IN ('player_connected', 'player_disconnected', 'playerlist_snapshot') THEN 2
             ELSE 3
           END AS event_priority,
           COALESCE(occurred_at, created_at) AS sort_time
       FROM player_events
       WHERE linked_server_id = ?
         AND event_type NOT LIKE 'player_hit%'
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
           4 AS event_priority,
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
       ORDER BY event_priority ASC, sort_time DESC, created_at DESC
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
      directPreferredFirst: true,
      maxListDirs: 2,
      maxListSearches: 1,
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
    if (newestReadableAdm) {
      await resetAdmReadFailureCounter(env, initialScope.linkedServerId);
    } else if (normalizedStatus === "latest_adm_unreadable" && (newestAvailableAdm?.name ?? batch.newestAdmFileName)) {
      await incrementAdmReadFailureCounter(
        env,
        initialScope.linkedServerId,
        newestAvailableAdm?.name ?? batch.newestAdmFileName ?? null,
        batch.readError ?? getUnavailableAdmMessage(status),
      );
    }
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
    const normalizedStatus = normalizeAdmSyncStateMachineStatus(status);
    if (normalizedStatus === "latest_adm_unreadable" && latestAdmFile) {
      await incrementAdmReadFailureCounter(env, initialScope.linkedServerId, latestAdmFile, safeSyncErrorMessage(error));
    }
    return {
      ok: !isAdmSyncErrorStatus(status),
      status: normalizedStatus,
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
  pending_import_jobs_processed: number;
  pending_import_chunks_processed: number;
  pending_import_jobs_completed: number;
  cron: string | null;
  maxServers: number;
  maxLinesPerServer: number;
  metadata: ScheduledMetadataSyncResult;
};

type AdmWorkerSelectedServer = SyncLinkedServer & {
  guild_id: string;
  plan_key: string | null;
  subscription_status: string | null;
  latest_adm_file: string | null;
  latest_adm_path: string | null;
  latest_adm_status: string | null;
  latest_adm_next_retry_at: string | null;
  last_processed_file: string | null;
  last_processed_line: number | null;
  last_processed_offset: number | null;
  target_adm_file: string | null;
  target_adm_path: string | null;
  active_import_jobs: number | null;
  encrypted_token: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
};

export type AdmWorkerSyncTickResult = ScheduledAdmSyncResult & {
  worker_hot_path: true;
  selected_linked_server_id: string | null;
  selected_adm_file: string | null;
  selected_adm_path: string | null;
  pre_read_d1_queries_estimate: number;
  pre_read_outbound_fetches_estimate: number;
  message: string;
};

export async function runAdmWorkerSyncTick(
  env: Env,
  options: {
    cron?: string | null;
    cursorKey?: string;
    maxLinesPerServer?: number;
    linkedServerId?: string | null;
    force?: boolean;
    targetFileName?: string | null;
    targetFilePath?: string | null;
  } = {},
): Promise<AdmWorkerSyncTickResult> {
  admSchemaEnsureSkipDepth += 1;
  try {
    const budget = getAdmInvocationBudget(env);
    const explicitTargetFileName = sanitizeWorkerTargetAdmFilename(options.targetFileName);
    const explicitTargetPath = explicitTargetFileName
      ? sanitizeWorkerTargetAdmPath(options.targetFilePath, explicitTargetFileName)
      : null;
    const selected = await selectAdmWorkerServer(env, options.cursorKey ?? "last_adm_linked_server_id", {
      linkedServerId: options.linkedServerId,
      force: options.force,
    });
    const metadata = emptyScheduledMetadataSyncResult();
    if (!selected) {
      return admWorkerResult({
        metadata,
        message: "No due ADM server or pending scheduled ADM import job found for this Worker tick.",
      });
    }

    const activeImportJobs = Number(selected.active_import_jobs ?? 0);
    let pendingJobs: PendingAdmImportJobsResult | undefined;
    if (activeImportJobs > 0 && !explicitTargetFileName) {
      pendingJobs = await processAdmImportJobsUntilBudget(env, {
        maxJobs: 1,
        maxChunksPerJob: SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK,
        maxRuntimeMs: 5_000,
        linkedServerId: selected.id,
        assumeSchemaReady: true,
      });
    }

    const pendingJobWorkCompleted = Boolean(pendingJobs && (pendingJobs.processedJobs > 0 || pendingJobs.chunksProcessed > 0 || pendingJobs.completedJobs > 0));
    if (pendingJobWorkCompleted && !explicitTargetFileName) {
      await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id).catch(() => null);
      const latestJob = pendingJobs?.results.at(-1) ?? null;
      return admWorkerResult({
        metadata,
        selectedLinkedServerId: selected.id,
        selectedAdmFile: latestJob?.filename ?? selected.target_adm_file ?? selected.latest_adm_file,
        selectedAdmPath: selected.target_adm_path ?? selected.latest_adm_path ?? selected.adm_path,
        pendingJobs,
        message: latestJob && isCompletedAdmImportJobStatus(latestJob.status)
          ? `Completed scheduled ADM chunk import for ${latestJob.filename}. Next Worker tick will discover or queue the next ADM file.`
          : latestJob
            ? `Processed scheduled ADM import chunk ${latestJob.display_current_chunk ?? latestJob.chunks_processed}/${latestJob.total_chunks} for ${latestJob.filename}. Next chunk continues automatically on the next Worker tick.`
            : "Processed scheduled ADM import work. Next Worker tick will continue automatic discovery or import.",
      });
    }

    if (!explicitTargetFileName) {
      const discoveryPlan = await planAdmBackfillJobsForServer(env, selected.user_id, selected.id, {
        triggerType: "scheduled_worker",
        chunksToProcess: SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK,
        processImmediately: false,
        maxJobsToCreate: Math.max(1, Math.min(budget.maxFilesPerInvocation, getAdmBackfillQueueLimit(selected.plan_key))),
        scheduledBudgeted: true,
        skipMetadataRefresh: true,
      });
      await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id).catch(() => null);
      const selectedJob = discoveryPlan.active_job ?? discoveryPlan.created_jobs[0] ?? null;
      const selectedFile = selectedJob?.filename ?? discoveryPlan.newest_available_adm_file ?? selected.target_adm_file ?? selected.latest_adm_file;
      return admWorkerResult({
        metadata,
        selectedLinkedServerId: selected.id,
        selectedAdmFile: selectedFile,
        selectedAdmPath: selected.target_adm_path ?? selected.latest_adm_path ?? selected.adm_path,
        pendingJobs,
        succeeded: discoveryPlan.created_jobs.length > 0 || Boolean(discoveryPlan.active_job) ? 1 : 0,
        unavailable: discoveryPlan.status === "latest_adm_unreadable" ? 1 : 0,
        skippedUnreadable: discoveryPlan.unreadable_files.length,
        latestAdmUnreadableCount: discoveryPlan.status === "latest_adm_unreadable" ? 1 : 0,
        newAdmReadableCount: discoveryPlan.created_jobs.length,
        processingProcessed: selectedJob ? 1 : 0,
        skippedNotDue: discoveryPlan.status === "adm_backfill_caught_up" ? 1 : 0,
        message: discoveryPlan.message,
      });
    }

    const preferLatestAfterImportWork = false;
    const latestBackoffActive = isAdmUnreadableBackoffActive(selected.latest_adm_status, selected.latest_adm_next_retry_at)
      && options.force !== true
      && !preferLatestAfterImportWork;
    const latestFileCandidates = latestBackoffActive
      ? []
      : [
          selected.latest_adm_file,
          fileNameFromPath(selected.latest_adm_path),
          fileNameFromPath(selected.adm_path),
        ];
    const latestPathCandidates = latestBackoffActive
      ? []
      : [
          selected.latest_adm_path,
          selected.adm_path,
        ];

    const directFileName = firstString(
      explicitTargetFileName,
      ...(preferLatestAfterImportWork
        ? [
            selected.latest_adm_file,
            fileNameFromPath(selected.latest_adm_path),
            selected.target_adm_file,
            fileNameFromPath(selected.target_adm_path),
            fileNameFromPath(selected.adm_path),
          ]
        : [
            selected.target_adm_file,
            fileNameFromPath(selected.target_adm_path),
            ...latestFileCandidates,
          ]),
    );
    const directPath = firstString(
      explicitTargetPath,
      ...(preferLatestAfterImportWork
        ? [
            selected.latest_adm_path,
            selected.target_adm_path,
            selected.adm_path,
            directFileName ? `dayzps/config/${directFileName}` : null,
          ]
        : [
            selected.target_adm_path,
            ...latestPathCandidates,
            directFileName ? `dayzps/config/${directFileName}` : null,
          ]),
    );

    if (!directFileName || !selected.nitrado_service_id) {
      await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id).catch(() => null);
      return admWorkerResult({
        metadata,
        selectedLinkedServerId: selected.id,
        selectedAdmFile: selected.target_adm_file ?? selected.latest_adm_file,
        selectedAdmPath: selected.target_adm_path ?? selected.latest_adm_path ?? selected.adm_path,
        pendingJobs,
        message: latestBackoffActive
          ? `Latest ADM ${selected.latest_adm_file} is unreadable; retry is scheduled for ${selected.latest_adm_next_retry_at}. Worker advanced to the next server.`
          : pendingJobs
          ? `Processed active ADM import work for ${selected.id}; no known latest ADM filename/path is available for direct re-read.`
          : "Selected ADM server has no known ADM filename/path yet; broad discovery is deferred to a separate run.",
        skippedNotDue: 1,
      });
    }

    if (!env.TOKEN_ENCRYPTION_KEY || !selected.encrypted_token || !selected.token_iv || !selected.token_auth_tag) {
      await incrementAdmReadFailureCounter(env, selected.id, directFileName, "No Nitrado token is available for ADM Worker file read.");
      await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id).catch(() => null);
      return admWorkerResult({
        metadata,
        selectedLinkedServerId: selected.id,
        selectedAdmFile: directFileName,
        selectedAdmPath: directPath ?? `dayzps/config/${directFileName}`,
        pendingJobs,
        failed: 1,
        message: "No Nitrado token is available for ADM Worker file read.",
      });
    }

    const token = await decryptToken(selected.encrypted_token, selected.token_iv, selected.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
    const read = await readAdmFileTextWithFallback({
      token,
      serviceId: selected.nitrado_service_id,
      fileName: directFileName,
      originalPath: directPath ?? `dayzps/config/${directFileName}`,
      options: {
        mode: "full",
        fullDownloadFallback: true,
        maxPathVariants: explicitTargetFileName ? 2 : Math.max(1, Math.min(2, budget.maxReadAttemptsPerFile)),
        maxTokenizedAttempts: budget.maxTokenizedAttemptsPerFile,
        maxChunkedReadChunks: budget.maxChunkedReadChunks,
        diagnostics: {
          db: requireDb(env),
          serverId: selected.id,
          serviceId: selected.nitrado_service_id,
          fileName: directFileName,
          budget: budget.diagnosticRows,
        },
      },
    });

    const scope = verifyAdmServerScope(selected, crypto.randomUUID());
    const discoveredFile: DiscoveredAdmFileForSync = {
      name: directFileName,
      path: read.selectedPath ?? directPath ?? `dayzps/config/${directFileName}`,
      timestamp: extractAdmTimestampScore(directFileName),
    };
    const lines = splitAdmText(read.text ?? "");
    const hasReadableAdm = read.ok && lines.length > 0;

    if (!hasReadableAdm) {
      const diagnostic = latestAdmFileReadDiagnostic(read);
      const message = summarizeAdmFileReadOutcomes(read)
        || read.downloadError
        || read.seekError
        || "Nitrado did not return readable DayZ ADM text for this file.";
      const stateLatestAdmFile = selected.latest_adm_file && compareAdmFileNamesChronological(selected.latest_adm_file, directFileName) >= 0
        ? selected.latest_adm_file
        : directFileName;
      const stateLatestAdmPath = stateLatestAdmFile === selected.latest_adm_file
        ? (selected.latest_adm_path ?? discoveredFile.path)
        : discoveredFile.path;
      await recordAdmFileAttempt(env, scope, discoveredFile, {
        status: "unreadable",
        lineCount: 0,
        rawKillLinesFound: 0,
        parsedKillLinesFound: 0,
        insertedKills: 0,
        parserSkippedLines: 0,
        message,
        diagnostic,
      });
      await incrementAdmReadFailureCounter(env, selected.id, stateLatestAdmFile, message);
      await upsertSyncState(env, selected.id, {
        latestAdmFile: stateLatestAdmFile,
        latestAdmPath: stateLatestAdmPath,
        sourceServiceId: selected.nitrado_service_id,
        lastProcessedFile: selected.last_processed_file,
        lastProcessedLine: Number(selected.last_processed_line ?? 0),
        lastProcessedOffset: Number(selected.last_processed_offset ?? 0),
        status: "latest_adm_unreadable",
        message,
        lastSyncAt: new Date().toISOString(),
        linesRead: 0,
        linesProcessed: 0,
        rawEventsStored: 0,
        playerEventsStored: 0,
        killEventsStored: 0,
        eventsCreated: 0,
        killsCreated: 0,
        unknownLines: 0,
        duplicateLines: 0,
        syncDurationMs: 0,
        readableRoute: null,
        rawKillLinesFound: 0,
        parsedKillLinesFound: 0,
        parserSkippedLines: 0,
        unreadableFilesQueued: 1,
        newestUnprocessedAdmFile: directFileName,
      });
      await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id).catch(() => null);
      return admWorkerResult({
        metadata,
        selectedLinkedServerId: selected.id,
        selectedAdmFile: directFileName,
        selectedAdmPath: discoveredFile.path,
        pendingJobs,
        latestAdmUnreadableCount: 1,
        unavailable: 1,
        skippedUnreadable: 1,
        message,
      });
    }

    await resetAdmReadFailureCounter(env, selected.id);
    const existingJob = await getAdmImportJobForFilename(env, selected.id, directFileName);
    if (existingJob) {
      const progress = toAdmImportJobProgress(existingJob);
      const completed = isCompletedAdmImportJobStatus(progress.status);
      if (completed || existingJob.source !== SCHEDULED_ADM_IMPORT_SOURCE || !existingJob.adm_text) {
        await recordAdmFileAttempt(env, scope, discoveredFile, {
          status: completed ? "processed" : "queued",
          lineCount: lines.length,
          rawKillLinesFound: lines.filter(hasRawPlayerKillLine).length,
          parsedKillLinesFound: 0,
          insertedKills: 0,
          parserSkippedLines: 0,
          lastLineProcessed: completed ? lines.length : 0,
          message: completed ? null : `ADM file ${directFileName} already has an import job from ${existingJob.source}.`,
        });
        await recordAdmImportJobProgressInSyncState(env, existingJob, completed ? "no_new_lines" : "processing_in_chunks", completed
          ? `ADM file ${directFileName} is already imported. DZN skipped duplicate Worker processing.`
          : `ADM file ${directFileName} already has an import job from ${existingJob.source}.`);
        await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id);
        return admWorkerResult({
          metadata,
          selectedLinkedServerId: selected.id,
          selectedAdmFile: directFileName,
          selectedAdmPath: discoveredFile.path,
          pendingJobs,
          processingProcessed: completed ? 0 : 1,
          skippedNotDue: completed ? 1 : 0,
          message: completed
            ? `ADM file ${directFileName} is already imported; Worker advanced to the next server.`
            : `ADM file ${directFileName} already has an active import job; Worker advanced to the next server.`,
        });
      }
    }
    await recordAdmFileAttempt(env, scope, discoveredFile, {
      status: "queued",
      lineCount: lines.length,
      rawKillLinesFound: lines.filter(hasRawPlayerKillLine).length,
      parsedKillLinesFound: 0,
      insertedKills: 0,
      parserSkippedLines: 0,
      message: null,
    });

    const job = existingJob
      ? toAdmImportJobProgress(existingJob)
      : await createAdmImportJobForServer(env, {
        linkedServerId: selected.id,
        filename: directFileName,
        admText: lines.join("\n"),
        source: SCHEDULED_ADM_IMPORT_SOURCE,
        chunkSize: budget.maxImportLinesPerInvocation,
      });
    await recordAdmImportJobProgressInSyncState(env, {
      id: job.job_id,
      server_id: selected.id,
      source_service_id: selected.nitrado_service_id,
      filename: directFileName,
      source: SCHEDULED_ADM_IMPORT_SOURCE,
      status: job.status,
      adm_text: lines.join("\n"),
      total_lines: job.total_lines,
      current_line: job.current_line,
      chunk_size: job.chunk_size,
      total_chunks: job.total_chunks,
      chunks_processed: job.chunks_processed,
      import_hit_lines: job.import_hit_lines ? 1 : 0,
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    }, "adm_import_job_queued", `Queued scheduled ADM chunk import for ${directFileName}.`);
    await updateAdmWorkerCursor(env, options.cursorKey ?? "last_adm_linked_server_id", selected.id);

    return admWorkerResult({
      metadata,
      selectedLinkedServerId: selected.id,
      selectedAdmFile: directFileName,
      selectedAdmPath: discoveredFile.path,
      pendingJobs,
      succeeded: 1,
      newAdmReadableCount: 1,
      processingProcessed: 1,
      message: pendingJobs && (pendingJobs.processedJobs > 0 || pendingJobs.chunksProcessed > 0)
        ? `Processed active ADM import work, then queued scheduled ADM chunk import for latest known file ${directFileName}.`
        : `Queued scheduled ADM chunk import for ${directFileName}.`,
    });
  } finally {
    admSchemaEnsureSkipDepth = Math.max(0, admSchemaEnsureSkipDepth - 1);
  }
}

async function selectAdmWorkerServer(env: Env, cursorKey: string, options: { linkedServerId?: string | null; force?: boolean } = {}): Promise<AdmWorkerSelectedServer | null> {
  const now = new Date().toISOString();
  const linkedServerId = options.linkedServerId ?? null;
  const force = options.force === true ? 1 : 0;
  const row = await requireDb(env)
    .prepare(
      `WITH cursor AS (
         SELECT value FROM adm_worker_state WHERE key = ? LIMIT 1
       ),
       eligible AS (
         SELECT
           linked_servers.id,
           linked_servers.user_id,
           linked_servers.guild_id,
           linked_servers.nitrado_service_id,
           linked_servers.server_name,
           linked_servers.display_name,
           linked_servers.hostname,
           linked_servers.nitrado_service_name,
           server_log_config.adm_path,
           server_subscriptions.plan_key,
           server_subscriptions.status AS subscription_status,
           COALESCE((
             SELECT adm_file
             FROM adm_sync_file_state latest_state
             WHERE latest_state.linked_server_id = linked_servers.id
               AND latest_state.ignored_at IS NULL
             ORDER BY latest_state.adm_file DESC
             LIMIT 1
           ), adm_sync_state.latest_adm_file) AS latest_adm_file,
           COALESCE((
             SELECT adm_path
             FROM adm_sync_file_state latest_state
             WHERE latest_state.linked_server_id = linked_servers.id
               AND latest_state.ignored_at IS NULL
             ORDER BY latest_state.adm_file DESC
             LIMIT 1
           ), adm_sync_state.latest_adm_path) AS latest_adm_path,
           (
             SELECT status
             FROM adm_sync_file_state latest_state
             WHERE latest_state.linked_server_id = linked_servers.id
               AND latest_state.ignored_at IS NULL
             ORDER BY latest_state.adm_file DESC
             LIMIT 1
           ) AS latest_adm_status,
           (
             SELECT next_retry_at
             FROM adm_sync_file_state latest_state
             WHERE latest_state.linked_server_id = linked_servers.id
               AND latest_state.ignored_at IS NULL
             ORDER BY latest_state.adm_file DESC
             LIMIT 1
           ) AS latest_adm_next_retry_at,
           adm_sync_state.last_processed_file,
           adm_sync_state.last_processed_line,
           adm_sync_state.last_processed_offset,
           (
             SELECT adm_file
             FROM adm_sync_file_state
             WHERE adm_sync_file_state.linked_server_id = linked_servers.id
               AND adm_sync_file_state.status IN ('discovered', 'unreadable')
               AND adm_sync_file_state.ignored_at IS NULL
               AND COALESCE(adm_sync_file_state.retry_count, 0) < 5
               AND (
                 adm_sync_file_state.status != 'unreadable'
                 OR adm_sync_file_state.next_retry_at IS NULL
                 OR adm_sync_file_state.next_retry_at <= ?
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM adm_import_jobs completed_or_active
                 WHERE completed_or_active.server_id = linked_servers.id
                   AND completed_or_active.filename = adm_sync_file_state.adm_file
                   AND completed_or_active.status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable', 'completed', 'completed_with_warnings')
               )
             ORDER BY adm_sync_file_state.adm_file ASC
             LIMIT 1
           ) AS target_adm_file,
           (
             SELECT adm_path
             FROM adm_sync_file_state
             WHERE adm_sync_file_state.linked_server_id = linked_servers.id
               AND adm_sync_file_state.status IN ('discovered', 'unreadable')
               AND adm_sync_file_state.ignored_at IS NULL
               AND COALESCE(adm_sync_file_state.retry_count, 0) < 5
               AND (
                 adm_sync_file_state.status != 'unreadable'
                 OR adm_sync_file_state.next_retry_at IS NULL
                 OR adm_sync_file_state.next_retry_at <= ?
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM adm_import_jobs completed_or_active
                 WHERE completed_or_active.server_id = linked_servers.id
                   AND completed_or_active.filename = adm_sync_file_state.adm_file
                   AND completed_or_active.status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding', 'failed_retryable', 'completed', 'completed_with_warnings')
               )
             ORDER BY adm_sync_file_state.adm_file ASC
             LIMIT 1
           ) AS target_adm_path,
           (
             SELECT COUNT(*)
             FROM adm_import_jobs
             WHERE adm_import_jobs.server_id = linked_servers.id
               AND adm_import_jobs.source = ?
               AND adm_import_jobs.status IN ('queued', 'processing', 'parsing', 'writing', 'failed_retryable', 'rebuilding')
           ) AS active_import_jobs,
           nitrado_connections.encrypted_token,
           nitrado_connections.token_iv,
           nitrado_connections.token_auth_tag
         FROM linked_servers
         JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
         JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
         LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
         LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
         LEFT JOIN nitrado_connections ON nitrado_connections.id = (
           SELECT id
           FROM nitrado_connections latest_connection
           WHERE latest_connection.user_id = linked_servers.user_id
             AND latest_connection.linked_server_id = linked_servers.id
           ORDER BY latest_connection.updated_at DESC, latest_connection.id DESC
           LIMIT 1
         )
         WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
           AND linked_servers.nitrado_service_id IS NOT NULL
           AND linked_servers.nitrado_service_id != ''
           AND lower(server_subscriptions.status) IN ('active', 'trialing')
           AND COALESCE(server_sync_state.currently_syncing_adm, 0) = 0
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND (? IS NULL OR linked_servers.id = ?)
           AND (
             ? = 1
             OR
             COALESCE(server_sync_state.next_adm_discovery_due_at, '1970-01-01T00:00:00.000Z') <= ?
             OR COALESCE(server_sync_state.next_adm_pull_due_at, '1970-01-01T00:00:00.000Z') <= ?
             OR EXISTS (
               SELECT 1
               FROM adm_import_jobs
               WHERE adm_import_jobs.server_id = linked_servers.id
                 AND adm_import_jobs.source = ?
                 AND adm_import_jobs.status IN ('queued', 'processing', 'parsing', 'writing', 'failed_retryable', 'rebuilding')
               LIMIT 1
             )
           )
       )
       SELECT *
       FROM eligible
       ORDER BY
         CASE WHEN COALESCE(active_import_jobs, 0) > 0 THEN 0 ELSE 1 END,
         CASE WHEN target_adm_file IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN id > COALESCE((SELECT value FROM cursor), '') THEN 0 ELSE 1 END,
         id ASC
       LIMIT 1`,
    )
    .bind(cursorKey, now, now, SCHEDULED_ADM_IMPORT_SOURCE, linkedServerId, linkedServerId, force, now, now, SCHEDULED_ADM_IMPORT_SOURCE)
    .first<AdmWorkerSelectedServer>();
  return row ?? null;
}

function isAdmUnreadableBackoffActive(status: string | null | undefined, nextRetryAt: string | null | undefined) {
  if (String(status ?? "").toLowerCase() !== "unreadable") return false;
  if (!nextRetryAt) return false;
  const retryAt = Date.parse(nextRetryAt);
  return Number.isFinite(retryAt) && retryAt > Date.now();
}

async function updateAdmWorkerCursor(env: Env, cursorKey: string, linkedServerId: string) {
  await requireDb(env)
    .prepare(
      `INSERT INTO adm_worker_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(cursorKey, linkedServerId, new Date().toISOString())
    .run();
}

function admWorkerResult(values: {
  metadata: ScheduledMetadataSyncResult;
  selectedLinkedServerId?: string | null;
  selectedAdmFile?: string | null;
  selectedAdmPath?: string | null;
  pendingJobs?: PendingAdmImportJobsResult;
  succeeded?: number;
  failed?: number;
  unavailable?: number;
  skippedUnreadable?: number;
  skippedNotDue?: number;
  latestAdmUnreadableCount?: number;
  newAdmReadableCount?: number;
  processingProcessed?: number;
  message: string;
}): AdmWorkerSyncTickResult {
  const pendingJobs = values.pendingJobs ?? {
    processedJobs: 0,
    completedJobs: 0,
    chunksProcessed: 0,
    failedJobs: 0,
    results: [],
  };
  return {
    ok: true,
    worker_hot_path: true,
    selected_linked_server_id: values.selectedLinkedServerId ?? null,
    selected_adm_file: values.selectedAdmFile ?? null,
    selected_adm_path: values.selectedAdmPath ?? null,
    pre_read_d1_queries_estimate: values.selectedLinkedServerId ? 1 : 1,
    pre_read_outbound_fetches_estimate: values.selectedAdmFile ? 1 : 0,
    message: values.message,
    processed: (values.processingProcessed ?? 0) + pendingJobs.processedJobs,
    succeeded: (values.succeeded ?? 0) + pendingJobs.completedJobs,
    failed: (values.failed ?? 0) + pendingJobs.failedJobs,
    unavailable: values.unavailable ?? 0,
    skipped: values.skippedNotDue ?? 0,
    discovery_due_count: values.selectedLinkedServerId ? 1 : 0,
    discovery_processed_count: values.selectedAdmFile ? 1 : 0,
    processing_due_count: values.selectedLinkedServerId ? 1 : 0,
    processing_processed_count: (values.processingProcessed ?? 0) + pendingJobs.processedJobs,
    skipped_not_due: values.skippedNotDue ?? 0,
    skipped_locked: 0,
    skipped_unreadable: values.skippedUnreadable ?? 0,
    waiting_after_restart_count: 0,
    latest_adm_unreadable_count: values.latestAdmUnreadableCount ?? 0,
    new_adm_readable_count: values.newAdmReadableCount ?? 0,
    new_data_found_count: pendingJobs.results.filter((job) => {
      const file = job.file_result;
      return file ? file.written_kills > 0 || file.player_events_stored > 0 || file.raw_events_stored > 0 : false;
    }).length,
    pending_import_jobs_processed: pendingJobs.processedJobs,
    pending_import_chunks_processed: pendingJobs.chunksProcessed,
    pending_import_jobs_completed: pendingJobs.completedJobs,
    cron: null,
    maxServers: 1,
    maxLinesPerServer: 15000,
    metadata: values.metadata,
  };
}

export async function runScheduledAdmSync(
  env: Env,
  options: {
    cron?: string | null;
    maxServers?: number;
    maxLinesPerServer?: number;
    minSyncIntervalMs?: number;
    refreshMetadata?: boolean;
    assumeSchemaReady?: boolean;
    linkedServerId?: string | null;
  } = {},
): Promise<ScheduledAdmSyncResult> {
  const skipSchemaEnsures = options.assumeSchemaReady === true && !isMockNitrado(env.MOCK_NITRADO);
  if (skipSchemaEnsures) admSchemaEnsureSkipDepth += 1;
  try {
  await ensureAdmSyncSchema(env);
  const maxServers = clampPositiveInteger(options.maxServers ?? 10, 10);
  const maxLinesPerServer = clampPositiveInteger(options.maxLinesPerServer ?? 50000, 50000);
  const minSyncIntervalMs = Math.max(clampPositiveInteger(options.minSyncIntervalMs ?? 10 * 60 * 1000, 10 * 60 * 1000), 10 * 60 * 1000);
  const metadata = options.refreshMetadata === false
    ? emptyScheduledMetadataSyncResult()
    : await refreshLivePlayerCountsForActiveServers(env, {
      maxServers,
      skipFreshWithinMs: 5 * 60 * 1000,
    });
  const pendingJobs = await processAdmImportJobsUntilBudget(env, {
    maxJobs: maxServers,
    maxChunksPerJob: SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK,
    maxRuntimeMs: 5_000,
    linkedServerId: options.linkedServerId ?? null,
  });
  const processedActiveImportWork = pendingJobs.processedJobs > 0 || pendingJobs.chunksProcessed > 0;
  const discoveryServers = processedActiveImportWork ? [] : await getDueAdmDiscoveryAutomationServers(env, maxServers, options.linkedServerId ?? null);
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

  const eligibleServers = processedActiveImportWork || discoveryProcessed > 0 ? [] : await getDueAdmAutomationServers(env, maxServers, minSyncIntervalMs, options.linkedServerId ?? null);
  let succeeded = 0;
  let failed = 0;
  let unavailable = 0;
  let processingProcessed = 0;
  let newDataFoundCount = 0;

  for (const server of eligibleServers) {
    try {
      await markAdmPullStarted(env, server.guild_id);
      processingProcessed += 1;
      const result = await planAdmBackfillJobsForServer(env, server.user_id, server.id, {
        triggerType: "scheduled",
        chunksToProcess: SCHEDULED_ADM_IMPORT_CHUNKS_PER_TICK,
        processImmediately: false,
        maxJobsToCreate: normalizePlanKey(server.plan_key) === "partner" ? 2 : 1,
        scheduledBudgeted: true,
        skipMetadataRefresh: true,
      });
      const ok = !isAdmSyncErrorStatus(result.status);
      if (!ok) failed += 1;
      else {
        if (isAdmSyncTemporarilyUnavailableStatus(result.status)) unavailable += 1;
        succeeded += 1;
      }
      if (result.unreadable_files.length && !result.created_jobs.length && !result.active_job) skippedUnreadable += 1;
      const job = result.active_job ?? result.created_jobs[0] ?? null;
      const fileResult = job?.file_result ?? null;
      const newDataFound = Boolean(fileResult && (fileResult.written_kills > 0 || fileResult.player_events_stored > 0 || fileResult.raw_events_stored > 0));
      await recordAdmPullResult(env, {
        guildId: server.guild_id,
        planKey: server.plan_key,
        ok,
        status: result.status,
        error: ok ? null : result.message,
        latestAdmFile: result.newest_available_adm_file,
        latestAdmTimestamp: result.newest_available_adm_timestamp ?? null,
        newestAvailableAdmFile: result.newest_available_adm_file,
        newestAvailableAdmTimestamp: result.newest_available_adm_timestamp ?? null,
        newestReadableAdmFile: result.newest_readable_adm_file ?? null,
        newestReadableAdmTimestamp: result.newest_readable_adm_timestamp ?? null,
        firstUsefulAdmLineAt: null,
        lastUsefulAdmEventAt: null,
        lastPlayerlistAt: null,
        processedAdmFile: job?.filename ?? result.newest_available_adm_file,
        processedOffset: job?.current_line ?? 0,
        processedLine: job?.current_line ?? 0,
        newDataFound,
      });
      if (newDataFound) newDataFoundCount += 1;
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
    processed: processingProcessed + pendingJobs.processedJobs,
    succeeded: succeeded + pendingJobs.completedJobs,
    failed: failed + pendingJobs.failedJobs,
    unavailable,
    skipped: Math.max(0, maxServers - processingProcessed),
    discovery_due_count: discoveryServers.length,
    discovery_processed_count: discoveryProcessed,
    processing_due_count: eligibleServers.length,
    processing_processed_count: processingProcessed + pendingJobs.processedJobs,
    skipped_not_due: Math.max(0, maxServers - Math.max(discoveryServers.length, eligibleServers.length)),
    skipped_locked: 0,
    skipped_unreadable: skippedUnreadable,
    waiting_after_restart_count: waitingAfterRestartCount,
    latest_adm_unreadable_count: latestAdmUnreadableCount,
    new_adm_readable_count: newAdmReadableCount,
    new_data_found_count: newDataFoundCount + pendingJobs.results.filter((job) => {
      const file = job.file_result;
      return file ? file.written_kills > 0 || file.player_events_stored > 0 || file.raw_events_stored > 0 : false;
    }).length,
    pending_import_jobs_processed: pendingJobs.processedJobs,
    pending_import_chunks_processed: pendingJobs.chunksProcessed,
    pending_import_jobs_completed: pendingJobs.completedJobs,
    cron: options.cron ?? null,
    maxServers,
    maxLinesPerServer,
    metadata,
  };
  } finally {
    if (skipSchemaEnsures) admSchemaEnsureSkipDepth = Math.max(0, admSchemaEnsureSkipDepth - 1);
  }
}

function emptyScheduledMetadataSyncResult(): ScheduledMetadataSyncResult {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    updated_player_counts: 0,
    results: [],
  };
}

export async function ensureAdmSyncSchema(env: Env) {
  if (admSchemaEnsureSkipDepth > 0) return;
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

async function getLinkedServerForAdmImport(env: Env, linkedServerId: string): Promise<ManualImportLinkedServer | null> {
  const row = await requireDb(env)
    .prepare(
      `SELECT
         linked_servers.id,
         linked_servers.user_id,
         linked_servers.guild_id,
         linked_servers.nitrado_service_id,
         linked_servers.server_name,
         linked_servers.display_name,
         linked_servers.hostname,
         linked_servers.nitrado_service_name,
         server_log_config.adm_path AS adm_path,
         server_subscriptions.plan_key,
         server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY server_subscriptions.updated_at DESC, server_subscriptions.created_at DESC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<SyncLinkedServer & {
      guild_id: string | null;
      plan_key: string | null;
      subscription_status: string | null;
    }>();
  if (!row) return null;
  return {
    ...row,
    plan_key: normalizePlanKey(row.plan_key),
    subscription_status: row.subscription_status ?? null,
  };
}

async function getLinkedServerForAdmImportByServiceId(env: Env, serviceId: string): Promise<ManualImportLinkedServer | null> {
  const row = await requireDb(env)
    .prepare(
      `SELECT
         linked_servers.id,
         linked_servers.user_id,
         linked_servers.guild_id,
         linked_servers.nitrado_service_id,
         linked_servers.server_name,
         linked_servers.display_name,
         linked_servers.hostname,
         linked_servers.nitrado_service_name,
         server_log_config.adm_path AS adm_path,
         server_subscriptions.plan_key,
         server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.nitrado_service_id = ?
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY server_subscriptions.updated_at DESC, server_subscriptions.created_at DESC, linked_servers.updated_at DESC
       LIMIT 1`,
    )
    .bind(serviceId)
    .first<SyncLinkedServer & {
      guild_id: string | null;
      plan_key: string | null;
      subscription_status: string | null;
    }>();
  if (!row) return null;
  return {
    ...row,
    plan_key: normalizePlanKey(row.plan_key),
    subscription_status: row.subscription_status ?? null,
  };
}

function sanitizeManualAdmFilename(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return null;
  const filename = fileNameFromPath(trimmed) ?? trimmed;
  if (!/\.(adm|txt)$/i.test(filename)) return null;
  if (/[<>:"\\|?*\u0000-\u001f]/.test(filename)) return null;
  return filename;
}

function sanitizeWorkerTargetAdmFilename(value: string | null | undefined) {
  const filename = typeof value === "string" ? sanitizeManualAdmFilename(value) : null;
  return filename && /\.adm$/i.test(filename) ? filename : null;
}

function sanitizeWorkerTargetAdmPath(value: string | null | undefined, filename: string) {
  const expected = `dayzps/config/${filename}`;
  if (typeof value !== "string") return expected;
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.length > 320 || normalized.includes("..") || /[\u0000-\u001f]/.test(normalized)) return expected;
  const withoutLeadingSlash = normalized.replace(/^\/+/, "");
  return withoutLeadingSlash.toLowerCase() === expected.toLowerCase()
    ? withoutLeadingSlash
    : expected;
}

function splitAdmText(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
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
    ["consecutive_failed_adm_reads", "INTEGER DEFAULT 0"],
  ]);
  await ensureMissingColumns(db, "adm_sync_file_state", [
    ["last_http_status", "INTEGER"],
    ["last_http_status_text", "TEXT"],
    ["last_endpoint_kind", "TEXT"],
    ["last_method", "TEXT"],
    ["last_response_excerpt", "TEXT"],
    ["last_diagnostic_at", "TEXT"],
    ["next_retry_at", "TEXT"],
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
  await ensureMissingColumns(db, "player_profiles", [
    ["source_service_id", "TEXT"],
    ["highest_killstreak", "INTEGER DEFAULT 0"],
    ["current_killstreak", "INTEGER DEFAULT 0"],
    ["total_time_alive_seconds", "INTEGER DEFAULT 0"],
    ["headshots", "INTEGER DEFAULT 0"],
    ["favourite_weapon", "TEXT DEFAULT 'Unknown'"],
    ["combat_logs_count", "INTEGER DEFAULT 0"],
    ["rage_quits_count", "INTEGER DEFAULT 0"],
    ["spawn_kills_count", "INTEGER DEFAULT 0"],
  ]);
  await ensureMissingColumns(db, "server_stats", [["source_service_id", "TEXT"]]);
  await ensureMissingColumns(db, "sync_runs", [["source_service_id", "TEXT"]]);
  for (const statement of ADM_SYNC_SCOPE_INDEX_STATEMENTS) {
    await db.prepare(statement).run();
  }
  for (const statement of PREMIUM_TELEMETRY_SCHEMA_STATEMENTS) {
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

async function resetAdmReadFailureCounter(env: Env, linkedServerId: string) {
  await requireDb(env)
    .prepare(
      `UPDATE adm_sync_state
       SET consecutive_failed_adm_reads = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE linked_server_id = ?`,
    )
    .bind(linkedServerId)
    .run();
}

async function incrementAdmReadFailureCounter(env: Env, linkedServerId: string, latestAdmFile: string | null, message: string | null) {
  await requireDb(env)
    .prepare(
      `INSERT INTO adm_sync_state (
        id, linked_server_id, latest_adm_file, last_sync_status, last_sync_message,
        consecutive_failed_adm_reads, created_at, updated_at
      ) VALUES (?, ?, ?, 'latest_adm_unreadable', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        latest_adm_file = COALESCE(excluded.latest_adm_file, adm_sync_state.latest_adm_file),
        last_sync_status = CASE
          WHEN adm_sync_state.last_sync_status IS NULL OR adm_sync_state.last_sync_status IN ('latest_adm_unreadable', 'adm_file_unreadable')
          THEN 'latest_adm_unreadable'
          ELSE adm_sync_state.last_sync_status
        END,
        last_sync_message = COALESCE(excluded.last_sync_message, adm_sync_state.last_sync_message),
        consecutive_failed_adm_reads = COALESCE(adm_sync_state.consecutive_failed_adm_reads, 0) + 1,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(crypto.randomUUID(), linkedServerId, latestAdmFile, message)
    .run();
}

async function recordAdmFileAttempt(
  env: Env,
  context: AdmSyncContext,
  file: DiscoveredAdmFileForSync,
  values: {
    status: "discovered" | "unreadable" | "queued" | "failed_unreadable" | "parser_error" | "write_error" | "processed" | "partial";
    lineCount: number;
    rawKillLinesFound: number;
    parsedKillLinesFound: number;
    insertedKills: number;
    parserSkippedLines: number;
    lastLineProcessed?: number;
    message: string | null;
    diagnostic?: {
      httpStatus?: number | null;
      httpStatusText?: string | null;
      endpointKind?: string | null;
      method?: string | null;
      responseExcerpt?: string | null;
    } | null;
  },
) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const currentRetryCount = values.status === "unreadable"
    ? await getAdmFileRetryCount(db, context, file.name).catch(() => 0)
    : 0;
  const nextRetryAt = values.status === "unreadable"
    ? new Date(Date.now() + getAdmUnreadableBackoffMs(currentRetryCount + 1)).toISOString()
    : null;
  const diagnostic = values.diagnostic
    ?? (values.status === "unreadable" ? await getLatestNitradoFileReadAttemptForState(db, context, file.name).catch(() => null) : null);
  await db
    .prepare(
      `INSERT INTO adm_sync_file_state (
        id, linked_server_id, source_service_id, adm_file, adm_path, status,
        first_seen_at, last_checked_at, last_readable_at, processed_at, line_count,
        last_line_processed, raw_kill_lines_found, parsed_kill_lines_found,
        inserted_kills, parser_skipped_lines, retry_count, last_error,
        last_http_status, last_http_status_text, last_endpoint_kind, last_method,
        last_response_excerpt, last_diagnostic_at, next_retry_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(linked_server_id, source_service_id, adm_file) DO UPDATE SET
        adm_path = COALESCE(excluded.adm_path, adm_sync_file_state.adm_path),
        status = CASE
          WHEN adm_sync_file_state.ignored_at IS NOT NULL THEN adm_sync_file_state.status
          WHEN excluded.status = 'discovered' AND adm_sync_file_state.status IN ('queued', 'processed', 'partial', 'failed_unreadable') THEN adm_sync_file_state.status
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
        next_retry_at = CASE
          WHEN excluded.status = 'unreadable' THEN excluded.next_retry_at
          WHEN excluded.status IN ('queued', 'processed', 'partial', 'failed_unreadable') THEN NULL
          ELSE adm_sync_file_state.next_retry_at
        END,
        last_error = CASE
          WHEN excluded.status = 'discovered' AND adm_sync_file_state.status IN ('queued', 'failed_unreadable') THEN adm_sync_file_state.last_error
          ELSE excluded.last_error
        END,
        last_http_status = COALESCE(excluded.last_http_status, adm_sync_file_state.last_http_status),
        last_http_status_text = COALESCE(excluded.last_http_status_text, adm_sync_file_state.last_http_status_text),
        last_endpoint_kind = COALESCE(excluded.last_endpoint_kind, adm_sync_file_state.last_endpoint_kind),
        last_method = COALESCE(excluded.last_method, adm_sync_file_state.last_method),
        last_response_excerpt = COALESCE(excluded.last_response_excerpt, adm_sync_file_state.last_response_excerpt),
        last_diagnostic_at = COALESCE(excluded.last_diagnostic_at, adm_sync_file_state.last_diagnostic_at),
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
      values.status === "processed" || values.status === "partial" || values.status === "queued" ? now : null,
      values.status === "processed" ? now : null,
      values.lineCount,
      values.lastLineProcessed ?? 0,
      values.rawKillLinesFound,
      values.parsedKillLinesFound,
      values.insertedKills,
      values.parserSkippedLines,
      values.status === "unreadable" ? 1 : 0,
      values.message,
      diagnostic?.httpStatus ?? null,
      diagnostic?.httpStatusText ?? null,
      diagnostic?.endpointKind ?? null,
      diagnostic?.method ?? null,
      diagnostic?.responseExcerpt ?? null,
      diagnostic ? now : null,
      nextRetryAt,
      now,
    )
    .run();
}

function getAdmUnreadableBackoffMs(retryAttempt: number) {
  if (retryAttempt <= 1) return 5 * 60 * 1000;
  if (retryAttempt === 2) return 15 * 60 * 1000;
  if (retryAttempt === 3) return 30 * 60 * 1000;
  return Math.min(6 * 60 * 60 * 1000, 60 * 60 * 1000);
}

async function getAdmFileRetryCount(db: D1Database, context: AdmSyncContext, filename: string) {
  const row = await db
    .prepare(
      `SELECT retry_count
       FROM adm_sync_file_state
       WHERE linked_server_id = ?
         AND source_service_id = ?
         AND adm_file = ?
       LIMIT 1`,
    )
    .bind(context.linkedServerId, context.nitradoServiceId, filename)
    .first<{ retry_count: number | null }>();
  return Number(row?.retry_count ?? 0);
}

async function getLatestNitradoFileReadAttemptForState(db: D1Database, context: AdmSyncContext, filename: string) {
  const row = await db
    .prepare(
      `SELECT method, endpoint_kind, status, http_status, http_status_text, error_code, error_message, response_excerpt
       FROM nitrado_file_read_attempts
       WHERE service_id = ?
         AND (server_id IS NULL OR server_id = ?)
         AND file_name = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(context.nitradoServiceId, context.linkedServerId, filename)
    .first<{
      method: string | null;
      endpoint_kind: string | null;
      status: string | null;
      http_status: number | null;
      http_status_text: string | null;
      error_code: string | null;
      error_message: string | null;
      response_excerpt: string | null;
    }>();
  if (!row) return null;
  return {
    httpStatus: row.http_status ?? null,
    httpStatusText: row.http_status_text ?? null,
    endpointKind: row.endpoint_kind ?? null,
    method: row.method ?? null,
    responseExcerpt: row.response_excerpt ?? null,
  };
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
      await evaluateLogTelemetrySequence(env, syncContext, parsed, {
        killerProfileId,
        victimProfileId,
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
      await evaluateLogTelemetrySequence(env, syncContext, parsed, {});
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

  await evaluateLogTelemetrySequence(env, syncContext, parsed, {
    playerProfileId,
  });

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

type TelemetryProfileRefs = {
  playerProfileId?: string | null;
  killerProfileId?: string | null;
  victimProfileId?: string | null;
};

type ParserStateRow = {
  id: string;
  linked_server_id: string;
  player_id: string;
  player_name: string | null;
  last_connected_at: string | null;
  last_combat_activity_at: string | null;
  last_died_at: string | null;
  alive_session_started_at: string | null;
};

async function evaluateLogTelemetrySequence(
  env: Env,
  context: AdmSyncContext,
  parsed: ParsedAdmEvent,
  profileRefs: TelemetryProfileRefs,
) {
  const occurredAt = validIsoDate(parsed.occurredAt) ?? new Date().toISOString();
  if (parsed.eventType === "player_connected" || parsed.eventType === "player_connecting") {
    await commitParserState(env, context, parsed.playerId, parsed.playerName, {
      last_connected_at: occurredAt,
      alive_session_started_at: occurredAt,
    });
    return;
  }

  if (parsed.eventType === "player_hit" || parsed.eventType === "player_hit_explosion" || parsed.eventType === "player_hit_unknown_attacker") {
    await commitParserState(env, context, parsed.playerId ?? parsed.victimId, parsed.playerName ?? parsed.victimName, {
      last_combat_activity_at: occurredAt,
    });
    if (parsed.attackerName || parsed.attackerId) {
      const attackerProfileId = parsed.attackerName
        ? await upsertPlayerProfile(env, context, parsed.attackerName, parsed.attackerId, occurredAt)
        : null;
      await commitParserState(env, context, parsed.attackerId, parsed.attackerName, {
        last_combat_activity_at: occurredAt,
      });
      if (attackerProfileId) {
        await touchProfileTelemetry(env, attackerProfileId);
      }
    }
    return;
  }

  if (isParsedBuildEvent(parsed)) {
    await commitParserState(env, context, parsed.playerId, parsed.playerName, {
      last_combat_activity_at: occurredAt,
    });
    return;
  }

  if (parsed.eventType === "player_killed" && parsed.isCreditedKill) {
    const killerProfileId = profileRefs.killerProfileId ?? null;
    const victimProfileId = profileRefs.victimProfileId ?? null;
    if (killerProfileId) {
      await incrementKillerTelemetry(env, context, killerProfileId, parsed, occurredAt);
    }
    if (victimProfileId) {
      await resetVictimKillstreak(env, victimProfileId);
      await closeAliveSession(env, context, parsed.victimId, parsed.victimName, victimProfileId, occurredAt);
    }
    const victimState = await getCachedParserState(env, context, parsed.victimId, parsed.victimName);
    if (killerProfileId && isWithinSeconds(victimState?.last_connected_at, occurredAt, 120)) {
      await incrementProfileCounter(env, killerProfileId, "spawn_kills_count", 1);
    }
    await commitParserState(env, context, parsed.killerId ?? parsed.playerId, parsed.killerName ?? parsed.playerName, {
      last_combat_activity_at: occurredAt,
    });
    await commitParserState(env, context, parsed.victimId, parsed.victimName, {
      last_combat_activity_at: occurredAt,
      last_died_at: occurredAt,
      alive_session_started_at: null,
    });
    return;
  }

  if (parsed.eventType === "player_suicide" || parsed.eventType === "player_killed_environment" || parsed.eventType === "player_died_stats") {
    if (profileRefs.playerProfileId) {
      await resetVictimKillstreak(env, profileRefs.playerProfileId);
      await closeAliveSession(env, context, parsed.playerId ?? parsed.victimId, parsed.playerName ?? parsed.victimName, profileRefs.playerProfileId, occurredAt);
    }
    await commitParserState(env, context, parsed.playerId ?? parsed.victimId, parsed.playerName ?? parsed.victimName, {
      last_died_at: occurredAt,
      alive_session_started_at: null,
    });
    return;
  }

  if (parsed.eventType === "player_disconnected") {
    const state = await getCachedParserState(env, context, parsed.playerId, parsed.playerName);
    if (profileRefs.playerProfileId) {
      if (isWithinSeconds(state?.last_combat_activity_at, occurredAt, 15)) {
        await incrementProfileCounter(env, profileRefs.playerProfileId, "combat_logs_count", 1);
      }
      if (isWithinSeconds(state?.last_died_at, occurredAt, 60)) {
        await incrementProfileCounter(env, profileRefs.playerProfileId, "rage_quits_count", 1);
      }
      await closeAliveSession(env, context, parsed.playerId, parsed.playerName, profileRefs.playerProfileId, occurredAt);
    }
    await commitParserState(env, context, parsed.playerId, parsed.playerName, {
      alive_session_started_at: null,
    });
  }
}

async function incrementKillerTelemetry(env: Env, context: AdmSyncContext, profileId: string, parsed: ParsedAdmEvent, occurredAt: string) {
  const db = requireDb(env);
  await db
    .prepare(
      `UPDATE player_profiles SET
        current_killstreak = COALESCE(current_killstreak, 0) + 1,
        highest_killstreak = MAX(COALESCE(highest_killstreak, 0), COALESCE(current_killstreak, 0) + 1),
        longest_kill_distance = MAX(COALESCE(longest_kill_distance, 0), ?),
        headshots = COALESCE(headshots, 0) + ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(numberOrZero(parsed.distance), isHeadshotLine(parsed.rawLine) ? 1 : 0, profileId)
    .run();
  if (parsed.weapon) {
    await updatePlayerWeaponFrequency(env, context, profileId, parsed.weapon);
  }
  await commitParserState(env, context, parsed.killerId ?? parsed.playerId, parsed.killerName ?? parsed.playerName, {
    last_combat_activity_at: occurredAt,
  });
}

async function resetVictimKillstreak(env: Env, profileId: string) {
  await requireDb(env)
    .prepare("UPDATE player_profiles SET current_killstreak = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(profileId)
    .run();
}

async function incrementProfileCounter(env: Env, profileId: string, column: TelemetryCounterColumn, amount: number) {
  await requireDb(env)
    .prepare(`UPDATE player_profiles SET ${column} = COALESCE(${column}, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(amount, profileId)
    .run();
}

async function updatePlayerWeaponFrequency(env: Env, context: AdmSyncContext, profileId: string, weapon: string) {
  const normalizedWeapon = weapon.trim().slice(0, 100) || "Unknown";
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO player_weapon_stats (
        player_profile_id, linked_server_id, weapon, kills, created_at, updated_at
      ) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(player_profile_id, weapon) DO UPDATE SET
        kills = COALESCE(kills, 0) + 1,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(profileId, context.linkedServerId, normalizedWeapon)
    .run();
  const favourite = await db
    .prepare(
      `SELECT weapon
       FROM player_weapon_stats
       WHERE player_profile_id = ?
       ORDER BY kills DESC, updated_at DESC, weapon ASC
       LIMIT 1`,
    )
    .bind(profileId)
    .first<{ weapon: string | null }>();
  await db
    .prepare("UPDATE player_profiles SET favourite_weapon = COALESCE(?, favourite_weapon, 'Unknown'), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(favourite?.weapon ?? normalizedWeapon, profileId)
    .run();
}

async function getCachedParserState(env: Env, context: AdmSyncContext, playerId: string | null | undefined, playerName: string | null | undefined) {
  const stateId = parserStateId(context, playerId, playerName);
  if (!stateId) return null;
  return requireDb(env)
    .prepare("SELECT * FROM player_parser_state WHERE id = ? LIMIT 1")
    .bind(stateId)
    .first<ParserStateRow>();
}

async function commitParserState(
  env: Env,
  context: AdmSyncContext,
  playerId: string | null | undefined,
  playerName: string | null | undefined,
  fields: Partial<Pick<ParserStateRow, "last_connected_at" | "last_combat_activity_at" | "last_died_at" | "alive_session_started_at">>,
) {
  const stateId = parserStateId(context, playerId, playerName);
  if (!stateId) return;
  const existing = await getCachedParserState(env, context, playerId, playerName);
  const now = new Date().toISOString();
  const cleanPlayerId = parserPlayerKey(playerId, playerName) ?? stateId;
  const cleanPlayerName = playerName?.trim() || existing?.player_name || null;
  await requireDb(env)
    .prepare(
      `INSERT INTO player_parser_state (
        id, linked_server_id, player_id, player_name,
        last_connected_at, last_combat_activity_at, last_died_at, alive_session_started_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(id) DO UPDATE SET
        player_name = excluded.player_name,
        last_connected_at = excluded.last_connected_at,
        last_combat_activity_at = excluded.last_combat_activity_at,
        last_died_at = excluded.last_died_at,
        alive_session_started_at = excluded.alive_session_started_at,
        updated_at = excluded.updated_at`,
    )
    .bind(
      stateId,
      context.linkedServerId,
      cleanPlayerId,
      cleanPlayerName,
      hasOwn(fields, "last_connected_at") ? fields.last_connected_at ?? null : existing?.last_connected_at ?? null,
      hasOwn(fields, "last_combat_activity_at") ? fields.last_combat_activity_at ?? null : existing?.last_combat_activity_at ?? null,
      hasOwn(fields, "last_died_at") ? fields.last_died_at ?? null : existing?.last_died_at ?? null,
      hasOwn(fields, "alive_session_started_at") ? fields.alive_session_started_at ?? null : existing?.alive_session_started_at ?? null,
      now,
    )
    .run();
}

async function closeAliveSession(
  env: Env,
  context: AdmSyncContext,
  playerId: string | null | undefined,
  playerName: string | null | undefined,
  profileId: string,
  eventAt: string,
) {
  const state = await getCachedParserState(env, context, playerId, playerName);
  const aliveFrom = state?.alive_session_started_at ?? state?.last_connected_at ?? null;
  const aliveSeconds = boundedSecondsBetween(aliveFrom, eventAt, 7 * 24 * 60 * 60);
  if (aliveSeconds > 0) {
    await incrementProfileCounter(env, profileId, "total_time_alive_seconds", aliveSeconds);
  }
}

async function touchProfileTelemetry(env: Env, profileId: string) {
  await requireDb(env)
    .prepare("UPDATE player_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(profileId)
    .run();
}

type TelemetryCounterColumn =
  | "total_time_alive_seconds"
  | "combat_logs_count"
  | "rage_quits_count"
  | "spawn_kills_count";

function parserStateId(context: AdmSyncContext, playerId: string | null | undefined, playerName: string | null | undefined) {
  const playerKey = parserPlayerKey(playerId, playerName);
  return playerKey ? `${context.linkedServerId}:${playerKey}` : null;
}

function parserPlayerKey(playerId: string | null | undefined, playerName: string | null | undefined) {
  const id = playerId?.trim();
  if (id) return id;
  const name = playerName?.trim().toLowerCase();
  return name || null;
}

function validIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isWithinSeconds(start: string | null | undefined, end: string, maxSeconds: number) {
  const seconds = boundedSecondsBetween(start, end, maxSeconds);
  return seconds >= 0 && seconds <= maxSeconds;
}

function boundedSecondsBetween(start: string | null | undefined, end: string, maxSeconds: number) {
  if (!start) return -1;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return -1;
  const seconds = Math.floor((endMs - startMs) / 1000);
  if (seconds < 0 || seconds > maxSeconds) return -1;
  return seconds;
}

function isHeadshotLine(rawLine: string) {
  return /\bhead\s*shot\b|\bheadshot\b|\bBrain\b|\bHead\b/i.test(rawLine);
}

function hasOwn<T extends object>(object: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(object, key);
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

export async function recordSyncRun(
  env: Env,
  values: {
    id?: string;
    linkedServerId: string | null;
    sourceServiceId?: string | null;
    triggerType: "manual" | "scheduled" | string;
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

async function getManualAdmImportHistory(env: Env, linkedServerId: string, limit: number): Promise<ManualAdmImportHistoryItem[]> {
  const rows = await requireDb(env)
    .prepare(
      `SELECT id, trigger_type, status, message, lines_read, kills_created, started_at, finished_at, created_at
       FROM sync_runs
       WHERE linked_server_id = ?
         AND trigger_type IN ('manual_paste', 'manual_upload')
       ORDER BY COALESCE(finished_at, started_at, created_at) DESC
       LIMIT ?`,
    )
    .bind(linkedServerId, limit)
    .all<AdmSyncRunSummary>();
  return (rows.results ?? []).map(mapManualAdmImportHistoryItem);
}

function mapManualAdmImportHistoryItem(row: AdmSyncRunSummary): ManualAdmImportHistoryItem {
  const parsed = parseManualAdmImportSyncRunMessage(row.message);
  return {
    id: row.id,
    filename: parsed.filename ?? null,
    imported_at: parsed.imported_at ?? row.finished_at ?? row.started_at ?? row.created_at,
    source: parsed.source ?? row.trigger_type,
    status: row.status,
    raw_lines: parsed.raw_lines ?? numberOrZero(row.lines_read),
    parsed_kills: parsed.parsed_kills ?? numberOrZero(row.kills_created),
    written_kills: parsed.written_kills ?? numberOrZero(row.kills_created),
    joins: parsed.joins ?? 0,
    disconnects: parsed.disconnects ?? 0,
    playerlist_snapshots: parsed.playerlist_snapshots ?? 0,
    duplicate_skips: parsed.duplicate_skips ?? 0,
    failed_writes: parsed.failed_writes ?? (row.status === "completed" ? 0 : 1),
  };
}

function parseManualAdmImportSyncRunMessage(value: string | null): Partial<ManualAdmImportHistoryItem> & {
  imported_at?: string | null;
  raw_lines?: number;
  parsed_kills?: number;
  written_kills?: number;
} {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.type !== "manual_adm_import") return {};
    return {
      filename: typeof parsed.filename === "string" ? parsed.filename : null,
      imported_at: typeof parsed.imported_at === "string" ? parsed.imported_at : null,
      source: typeof parsed.source === "string" ? parsed.source : "manual_paste",
      raw_lines: numberOrZero(parsed.raw_lines),
      parsed_kills: numberOrZero(parsed.parsed_kills),
      written_kills: numberOrZero(parsed.written_kills),
      joins: numberOrZero(parsed.joins),
      disconnects: numberOrZero(parsed.disconnects),
      playerlist_snapshots: numberOrZero(parsed.playerlist_snapshots),
      duplicate_skips: numberOrZero(parsed.duplicate_skips),
      failed_writes: numberOrZero(parsed.failed_writes),
    };
  } catch {
    return {};
  }
}

function mapSyncRunSummary(row: AdmSyncRunSummary): AdmSyncRunSummary {
  return {
    id: row.id,
    trigger_type: row.trigger_type,
    status: row.status,
    message: formatAdmSyncRunSummaryMessage(row.message) ?? row.message,
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

function formatAdmSyncRunSummaryMessage(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const type = String(parsed.type ?? "");
    if (type !== "scheduled_adm_import" && type !== "manual_adm_import" && type !== "adm_import") return null;
    const filename = typeof parsed.filename === "string" && parsed.filename.trim() ? parsed.filename : "ADM file";
    const rawLines = numberOrZero(parsed.raw_lines);
    const writtenKills = numberOrZero(parsed.written_kills);
    const joins = numberOrZero(parsed.joins);
    const disconnects = numberOrZero(parsed.disconnects);
    const playerlistSnapshots = numberOrZero(parsed.playerlist_snapshots);
    const duplicateSkips = numberOrZero(parsed.duplicate_skips);
    const prefix = type === "scheduled_adm_import" ? "Scheduled ADM import completed" : "ADM import completed";
    return `${prefix} for ${filename}. Lines read: ${rawLines}. Kills: ${writtenKills}. Joins: ${joins}. Disconnects: ${disconnects}. PlayerList snapshots: ${playerlistSnapshots}. Duplicates skipped: ${duplicateSkips}.`;
  } catch {
    return null;
  }
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
    diagnostics: {
      db: requireDb(env),
      serverId: linkedServer.id,
      serviceId: linkedServer.nitrado_service_id,
      fileName: options.preferredAdmFileName ?? undefined,
      filePath: options.preferredAdmPath ?? linkedServer.adm_path,
    },
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
    lookbackFiles?: number;
    directPreferredFirst?: boolean;
    maxListDirs?: number;
    maxListSearches?: number;
    budget?: AdmInvocationBudget;
  } = {},
): Promise<{ files: ReadableAdmFileForSync[]; candidates: DiscoveredAdmFileForSync[]; filesFound: number; newestAdmFileName: string | null; apiStatus: string; message: string; readErrors: string[]; readError: string | null }> {
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
      readErrors: [],
      readError: null,
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
      readErrors: ["No Nitrado token or service ID is available for ADM log reading."],
      readError: "No Nitrado token or service ID is available for ADM log reading.",
    };
  }

  const token = await getNitradoTokenForLinkedServer(env, linkedServer);
  const batch = await fetchReadableNitradoAdmFiles(token, linkedServer.nitrado_service_id, {
    mode: options.readMode ?? "sample",
    previousLatestAdmFileName: options.previousLatestAdmFileName,
    preferredAdmPath: options.preferredAdmPath ?? linkedServer.adm_path,
    maxFiles: options.maxFiles,
    lookbackFiles: options.lookbackFiles,
    directPreferredFirst: options.directPreferredFirst,
    maxListDirs: options.maxListDirs,
    maxListSearches: options.maxListSearches,
    maxPathVariants: options.readMode === "full" ? options.budget?.maxReadAttemptsPerFile ?? 4 : 1,
    maxTokenizedAttempts: options.budget?.maxTokenizedAttemptsPerFile ?? (options.readMode === "full" ? 2 : 1),
    maxChunkedReadChunks: options.budget?.maxChunkedReadChunks,
    diagnostics: {
      db: requireDb(env),
      serverId: linkedServer.id,
      serviceId: linkedServer.nitrado_service_id,
      budget: options.budget?.diagnosticRows,
    },
  });

  return {
    files: batch.files.map(mapReadableAdmFileForSync),
    candidates: batch.candidates.map(mapDiscoveredAdmFileForSync),
    filesFound: batch.filesFound,
    newestAdmFileName: batch.newestAdmFileName,
    apiStatus: batch.apiStatus,
    message: batch.files.length
      ? `Readable ADM files discovered: ${batch.files.map((file) => file.name).join(", ")}`
      : batch.readError ?? "ADM file list was discovered, but no readable ADM file content was returned.",
    readErrors: batch.readErrors,
    readError: batch.readError,
  };
}

async function readSpecificAdmFileForBackfill(
  env: Env,
  linkedServer: SyncLinkedServer,
  candidate: DiscoveredAdmFileForSync,
  budget: AdmInvocationBudget = getAdmInvocationBudget(env),
): Promise<{
  file: ReadableAdmFileForSync | null;
  error: string | null;
  diagnostic: ReturnType<typeof latestAdmFileReadDiagnostic> | null;
}> {
  if (!linkedServer.nitrado_service_id) {
    return { file: null, error: "No Nitrado service ID is available for ADM backfill reading.", diagnostic: null };
  }

  try {
    const token = await getNitradoTokenForLinkedServer(env, linkedServer);
    const read = await readAdmFileTextWithFallback({
      token,
      serviceId: linkedServer.nitrado_service_id,
      fileName: candidate.name,
      originalPath: candidate.path,
      options: {
        mode: "full",
        fullDownloadFallback: true,
        maxPathVariants: Math.min(1, budget.maxReadAttemptsPerFile),
        maxTokenizedAttempts: budget.maxTokenizedAttemptsPerFile,
        maxChunkedReadChunks: budget.maxChunkedReadChunks,
        diagnostics: {
          db: requireDb(env),
          serverId: linkedServer.id,
          serviceId: linkedServer.nitrado_service_id,
          fileName: candidate.name,
          filePath: candidate.path ?? candidate.name,
          budget: budget.diagnosticRows,
        },
      },
    });
    const diagnostic = latestAdmFileReadDiagnostic(read);
    const lines = splitAdmText(read.text ?? "");
    if (!read.ok || !looksLikeAdmText(lines)) {
      const outcomeSummary = summarizeAdmFileReadOutcomes(read);
      return {
        file: null,
        error: `${candidate.name} unreadable: ${outcomeSummary}.`,
        diagnostic,
      };
    }

    return {
      file: {
        name: candidate.name,
        path: read.selectedPath ?? candidate.path,
        lines,
        readableRouteUsed: read.readMethod === "seek" ? "file_server_seek" : "file_server_download_fallback",
      },
      error: null,
      diagnostic,
    };
  } catch (error) {
    return { file: null, error: safeSyncErrorMessage(error), diagnostic: null };
  }
}

type UnreadableAdmFileRetryRow = {
  adm_file: string;
  adm_path: string | null;
  retry_count: number | null;
  last_checked_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
};

async function retryUnreadableAdmFileStatesForServer(
  env: Env,
  linkedServer: ManualImportLinkedServer,
  scope: AdmSyncContext,
  options: {
    handledFilenames: string[];
    limit: number;
    onlyLatest?: boolean;
    budget?: AdmInvocationBudget;
  },
): Promise<{
  createdJobs: AdmImportJobProgressResult[];
  readableFiles: ReadableAdmFileForSync[];
  readErrorsByFilename: Map<string, string | null>;
}> {
  await markExpiredUnreadableAdmFilesFailed(env, scope);
  const db = requireDb(env);
  const cutoff = new Date(Date.now() - ADM_UNREADABLE_RETRY_AFTER_MS).toISOString();
  const orderBy = options.onlyLatest ? "adm_file DESC" : "adm_file ASC";
  const rows = await db
    .prepare(
      `SELECT adm_file, adm_path, retry_count, last_checked_at, last_error
       FROM adm_sync_file_state
       WHERE linked_server_id = ?
         AND source_service_id = ?
         AND status = 'unreadable'
         AND COALESCE(retry_count, 0) < ?
         AND (
           next_retry_at IS NULL
           OR next_retry_at <= ?
           OR (last_checked_at IS NULL OR last_checked_at <= ?)
         )
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
    .bind(scope.linkedServerId, scope.nitradoServiceId, ADM_UNREADABLE_RETRY_LIMIT, new Date().toISOString(), cutoff, Math.max(1, options.limit))
    .all<UnreadableAdmFileRetryRow>();

  const handled = new Set(options.handledFilenames.map(normalizeAdmFilenameKey).filter(Boolean));
  const budget = options.budget ?? getAdmInvocationBudget(env);
  const createdJobs: AdmImportJobProgressResult[] = [];
  const readableFiles: ReadableAdmFileForSync[] = [];
  const readErrorsByFilename = new Map<string, string | null>();

  for (const row of rows.results ?? []) {
    const filename = sanitizeManualAdmFilename(row.adm_file);
    if (!filename) continue;
    const filenameKey = normalizeAdmFilenameKey(filename);
    const candidate: DiscoveredAdmFileForSync = {
      name: filename,
      path: row.adm_path,
      timestamp: extractAdmTimestampScore(filename),
    };

    const existingJob = await getAdmImportJobForFilename(env, scope.linkedServerId, filename);
    if (handled.has(filenameKey) || (existingJob && isCompletedAdmImportJobStatus(existingJob.status))) {
      await recordAdmFileAttempt(env, scope, candidate, {
        status: "processed",
        lineCount: Number(existingJob?.total_lines ?? 0),
        rawKillLinesFound: Number(existingJob?.raw_kill_lines_found ?? existingJob?.parsed_kills ?? 0),
        parsedKillLinesFound: Number(existingJob?.parsed_kills ?? 0),
        insertedKills: Number(existingJob?.written_kills ?? 0),
        parserSkippedLines: 0,
        lastLineProcessed: Number(existingJob?.current_line ?? existingJob?.total_lines ?? 0),
        message: null,
      });
      continue;
    }

    if (existingJob && isActiveAdmImportJobStatus(existingJob.status)) {
      await recordAdmFileAttempt(env, scope, candidate, {
        status: "queued",
        lineCount: Number(existingJob.total_lines ?? 0),
        rawKillLinesFound: Number(existingJob.raw_kill_lines_found ?? existingJob.parsed_kills ?? 0),
        parsedKillLinesFound: Number(existingJob.parsed_kills ?? 0),
        insertedKills: Number(existingJob.written_kills ?? 0),
        parserSkippedLines: 0,
        lastLineProcessed: Number(existingJob.current_line ?? 0),
        message: null,
      });
      continue;
    }

    const read = await readSpecificAdmFileForBackfill(env, linkedServer, candidate, budget);
    if (read.file?.lines.length) {
      readableFiles.push(read.file);
      await resetAdmReadFailureCounter(env, scope.linkedServerId);
      const report = buildAdmImportDebugReport(read.file.lines, {
        admFileName: read.file.name,
        cursorStart: 0,
        cursorEnd: read.file.lines.length,
      });
      const created = await createAdmImportJobForServer(env, {
        linkedServerId: scope.linkedServerId,
        filename: read.file.name,
        admText: read.file.lines.join("\n"),
        source: SCHEDULED_ADM_IMPORT_SOURCE,
        chunkSize: SCHEDULED_ADM_IMPORT_CHUNK_SIZE,
      });
      const jobRow = await getAdmImportJob(env, scope.linkedServerId, created.job_id);
      if (jobRow) {
        await recordAdmImportJobProgressInSyncState(env, jobRow, "adm_backfill_queued", `Re-read unreadable ADM file ${read.file.name} and queued it for scheduled import.`);
      }
      await recordAdmFileAttempt(env, scope, {
        name: read.file.name,
        path: read.file.path,
        timestamp: extractAdmTimestampScore(read.file.name),
      }, {
        status: "queued",
        lineCount: read.file.lines.length,
        rawKillLinesFound: report.rawKilledByLinesFound,
        parsedKillLinesFound: report.parsedPvpKills,
        insertedKills: 0,
        parserSkippedLines: report.skippedDeadHitLines,
        lastLineProcessed: 0,
        message: null,
        diagnostic: read.diagnostic,
      });
      createdJobs.push(jobRow ? toAdmImportJobProgress(jobRow) : created);
      continue;
    }

    const error = read.error ?? "ADM file still exists on Nitrado but did not return readable DayZ admin log text.";
    readErrorsByFilename.set(filename, error);
    await recordAdmFileAttempt(env, scope, candidate, {
      status: "unreadable",
      lineCount: 0,
      rawKillLinesFound: 0,
      parsedKillLinesFound: 0,
      insertedKills: 0,
      parserSkippedLines: 0,
      message: error,
      diagnostic: read.diagnostic,
    });
    if (Number(row.retry_count ?? 0) + 1 >= ADM_UNREADABLE_RETRY_LIMIT) {
      await markAdmFileFailedUnreadable(env, scope, filename, error);
    }
  }

  await markExpiredUnreadableAdmFilesFailed(env, scope);
  return { createdJobs, readableFiles, readErrorsByFilename };
}

export async function retryUnreadableAdmFilesForService(
  env: Env,
  options: {
    serviceId: string;
    limit?: number;
    onlyLatest?: boolean;
  },
) {
  await ensureAdmSyncSchema(env);
  const serviceId = String(options.serviceId ?? "").trim();
  if (!serviceId) throw new Error("Nitrado service id is required");
  const linkedServer = await getLinkedServerForAdmImportByServiceId(env, serviceId);
  if (!linkedServer) throw new Error("No linked server found for that Nitrado service id");
  const scope = verifyAdmServerScope(linkedServer, crypto.randomUUID());
  const handledFilenames = await getHandledAdmFilenames(env, scope.linkedServerId, scope.nitradoServiceId);
  const beforeRows = await requireDb(env)
    .prepare(
      `SELECT adm_file
       FROM adm_sync_file_state
       WHERE linked_server_id = ?
         AND source_service_id = ?
         AND status = 'unreadable'
       ORDER BY adm_file ${options.onlyLatest ? "DESC" : "ASC"}
       LIMIT ?`,
    )
    .bind(scope.linkedServerId, scope.nitradoServiceId, Math.max(1, Math.min(25, Math.trunc(Number(options.limit ?? 5) || 5))))
    .all<{ adm_file: string }>();
  const result = await retryUnreadableAdmFileStatesForServer(env, linkedServer, scope, {
    handledFilenames,
    limit: Math.max(1, Math.min(25, Math.trunc(Number(options.limit ?? 5) || 5))),
    onlyLatest: options.onlyLatest,
  });
  const readable = result.readableFiles.length;
  const stillUnreadable = result.readErrorsByFilename.size;
  return {
    ok: true,
    serviceId,
    linkedServerId: scope.linkedServerId,
    retried: (beforeRows.results ?? []).length,
    readable,
    stillUnreadable,
    queued: result.createdJobs.length,
    queuedJobs: result.createdJobs,
    details: [
      ...result.readableFiles.map((file) => ({
        filename: file.name,
        status: "queued",
        lineCount: file.lines.length,
      })),
      ...[...result.readErrorsByFilename.entries()].map(([filename, error]) => ({
        filename,
        status: "still_unreadable",
        error,
      })),
    ],
  };
}

async function markExpiredUnreadableAdmFilesFailed(env: Env, scope: AdmSyncContext) {
  await requireDb(env)
    .prepare(
      `UPDATE adm_sync_file_state
       SET status = 'failed_unreadable',
           last_error = COALESCE(last_error, ?),
           next_retry_at = NULL,
           updated_at = ?
       WHERE linked_server_id = ?
         AND source_service_id = ?
         AND status = 'unreadable'
         AND COALESCE(retry_count, 0) >= ?`,
    )
    .bind(
      "ADM file remained unreadable after 5 Nitrado read attempts. Check Nitrado Admin Log, Reduce Log Output, and Log Playerlist settings.",
      new Date().toISOString(),
      scope.linkedServerId,
      scope.nitradoServiceId,
      ADM_UNREADABLE_RETRY_LIMIT,
    )
    .run();
}

async function markAdmFileFailedUnreadable(env: Env, scope: AdmSyncContext, filename: string, error: string) {
  await requireDb(env)
    .prepare(
      `UPDATE adm_sync_file_state
       SET status = 'failed_unreadable',
           last_error = ?,
           next_retry_at = NULL,
           updated_at = ?
       WHERE linked_server_id = ?
         AND source_service_id = ?
         AND adm_file = ?`,
    )
    .bind(
      `ADM file remained unreadable after ${ADM_UNREADABLE_RETRY_LIMIT} Nitrado read attempts. Last error: ${safeSyncErrorMessage(error)}`,
      new Date().toISOString(),
      scope.linkedServerId,
      scope.nitradoServiceId,
      filename,
    )
    .run();
}

function looksLikeAdmText(lines: string[]) {
  return lines.some((line) => /^\d{1,2}:\d{2}(?::\d{2})?\s*\|/.test(line) || /AdminLog|PlayerList|killed by Player|is connected|is connecting|disconnected/i.test(line));
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
      parsedJoins: numberOrZero(parsed.parsedJoins),
      parsedDisconnects: numberOrZero(parsed.parsedDisconnects),
      parsedPlayerlistSnapshots: numberOrZero(parsed.parsedPlayerlistSnapshots),
      parsedHitLines: numberOrZero(parsed.parsedHitLines),
      skippedDeadHitLines: numberOrZero(parsed.skippedDeadHitLines),
      parsedSuicides: numberOrZero(parsed.parsedSuicides),
      parsedUncreditedDeaths: numberOrZero(parsed.parsedUncreditedDeaths),
      duplicateSkips: numberOrZero(parsed.duplicateSkips),
      pvpKillLineNumbers: Array.isArray(parsed.pvpKillLineNumbers) ? parsed.pvpKillLineNumbers.map(numberOrZero).filter((line) => line > 0) : [],
      importSource: typeof parsed.importSource === "string" ? parsed.importSource : null,
      importedAt: typeof parsed.importedAt === "string" ? parsed.importedAt : null,
      importReportId: typeof parsed.importReportId === "string" ? parsed.importReportId : null,
      parserWarnings: Array.isArray(parsed.parserWarnings) ? parsed.parserWarnings.filter((warning): warning is string => typeof warning === "string") : [],
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
    consecutive_failed_adm_reads INTEGER DEFAULT 0,
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
    last_http_status INTEGER,
    last_http_status_text TEXT,
    last_endpoint_kind TEXT,
    last_method TEXT,
    last_response_excerpt TEXT,
    last_diagnostic_at TEXT,
    next_retry_at TEXT,
    ignored_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS nitrado_file_read_attempts (
    id TEXT PRIMARY KEY,
    server_id TEXT,
    service_id TEXT NOT NULL,
    file_name TEXT,
    file_path TEXT,
    method TEXT NOT NULL,
    endpoint_kind TEXT NOT NULL,
    attempt_number INTEGER DEFAULT 1,
    status TEXT NOT NULL,
    http_status INTEGER,
    http_status_text TEXT,
    error_code TEXT,
    error_message TEXT,
    response_excerpt TEXT,
    response_headers_json TEXT,
    duration_ms INTEGER,
    request_url_redacted TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS adm_import_jobs (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    source_service_id TEXT,
    filename TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual_file_upload',
    status TEXT NOT NULL DEFAULT 'queued',
    adm_text TEXT NOT NULL,
    total_lines INTEGER DEFAULT 0,
    current_line INTEGER DEFAULT 0,
    chunk_size INTEGER DEFAULT 25,
    total_chunks INTEGER DEFAULT 1,
    chunks_processed INTEGER DEFAULT 0,
    import_hit_lines INTEGER DEFAULT 0,
    raw_kill_lines_found INTEGER DEFAULT 0,
    last_chunk_index INTEGER DEFAULT -1,
    failed_chunk_index INTEGER,
    parsed_kills INTEGER DEFAULT 0,
    written_kills INTEGER DEFAULT 0,
    duplicate_skips INTEGER DEFAULT 0,
    joins INTEGER DEFAULT 0,
    disconnects INTEGER DEFAULT 0,
    playerlist_snapshots INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    suicides INTEGER DEFAULT 0,
    uncredited_deaths INTEGER DEFAULT 0,
    hit_lines INTEGER DEFAULT 0,
    raw_events INTEGER DEFAULT 0,
    player_events INTEGER DEFAULT 0,
    failed_writes INTEGER DEFAULT 0,
    public_cache_updated INTEGER DEFAULT 0,
    discord_jobs_queued INTEGER DEFAULT 0,
    warnings_json TEXT,
    error_message TEXT,
    result_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
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
    highest_killstreak INTEGER DEFAULT 0,
    current_killstreak INTEGER DEFAULT 0,
    total_time_alive_seconds INTEGER DEFAULT 0,
    headshots INTEGER DEFAULT 0,
    favourite_weapon TEXT DEFAULT 'Unknown',
    combat_logs_count INTEGER DEFAULT 0,
    rage_quits_count INTEGER DEFAULT 0,
    spawn_kills_count INTEGER DEFAULT 0,
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
  "CREATE INDEX IF NOT EXISTS idx_adm_sync_file_state_retry ON adm_sync_file_state(status, next_retry_at)",
  "CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_service_id ON nitrado_file_read_attempts(service_id)",
  "CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_server_id ON nitrado_file_read_attempts(server_id)",
  "CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_file_name ON nitrado_file_read_attempts(file_name)",
  "CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_status ON nitrado_file_read_attempts(status)",
  "CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_http_status ON nitrado_file_read_attempts(http_status)",
  "CREATE INDEX IF NOT EXISTS idx_nitrado_file_read_attempts_created_at ON nitrado_file_read_attempts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_adm_import_jobs_server ON adm_import_jobs(server_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_adm_import_jobs_status ON adm_import_jobs(status, updated_at)",
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

const PREMIUM_TELEMETRY_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS player_parser_state (
    id TEXT PRIMARY KEY,
    linked_server_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    player_name TEXT,
    last_connected_at TEXT,
    last_combat_activity_at TEXT,
    last_died_at TEXT,
    alive_session_started_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(linked_server_id, player_id)
  )`,
  `CREATE TABLE IF NOT EXISTS player_weapon_stats (
    player_profile_id TEXT NOT NULL,
    linked_server_id TEXT NOT NULL,
    weapon TEXT NOT NULL,
    kills INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(player_profile_id, weapon)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_highest_streak ON player_profiles(highest_killstreak DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_longest_kill ON player_profiles(longest_kill_distance DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_time_alive ON player_profiles(total_time_alive_seconds DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_headshots ON player_profiles(headshots DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_combat_logs ON player_profiles(combat_logs_count DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_rage_quits ON player_profiles(rage_quits_count DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_profiles_spawn_kills ON player_profiles(spawn_kills_count DESC)",
  "CREATE INDEX IF NOT EXISTS idx_player_parser_state_server_player ON player_parser_state(linked_server_id, player_id)",
  "CREATE INDEX IF NOT EXISTS idx_player_parser_state_combat ON player_parser_state(last_combat_activity_at)",
  "CREATE INDEX IF NOT EXISTS idx_player_weapon_stats_server_weapon ON player_weapon_stats(linked_server_id, weapon, kills DESC)",
];
