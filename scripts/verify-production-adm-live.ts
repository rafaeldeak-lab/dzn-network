import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type CheckStatus = "pass" | "warn" | "fail";

type Check = {
  status: CheckStatus;
  title: string;
  detail: string;
  evidence?: unknown;
};

type LinkedServerRow = {
  id: string;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_id: string;
  plan_key: string | null;
  subscription_status: string | null;
  current_players: number | null;
  max_players: number | null;
  player_count_last_checked_at: string | null;
  metadata_last_checked_at: string | null;
  latest_adm_file: string | null;
  last_processed_file: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  last_worker_selected_at: string | null;
  selected_count: number | null;
  last_selection_reason: string | null;
  rate_limited_until: string | null;
};

type FileStateRow = {
  linked_server_id: string;
  source_service_id: string;
  adm_file: string;
  adm_path: string | null;
  status: string | null;
  line_count: number | null;
  latest_known_line_count: number | null;
  imported_line_count: number | null;
  cursor_line: number | null;
  last_read_at: string | null;
  last_growth_at: string | null;
  last_endpoint_kind: string | null;
  last_method: string | null;
  next_retry_at: string | null;
  last_http_status: number | null;
  last_error: string | null;
  retry_count: number | null;
};

type JobRow = {
  server_id: string;
  source_service_id: string | null;
  filename: string;
  source: string;
  status: string;
  current_line: number | null;
  total_lines: number | null;
  chunks_processed: number | null;
  total_chunks: number | null;
  parsed_kills: number | null;
  written_kills: number | null;
  joins: number | null;
  disconnects: number | null;
  playerlist_snapshots: number | null;
  updated_at: string | null;
  completed_at: string | null;
};

type SourceStateRow = {
  service_id: string;
  source_name: string;
  last_tested_at: string | null;
  last_status: string | null;
  last_http_status: number | null;
  last_error_code: string | null;
  works: number | null;
  preferred: number | null;
  next_test_at: string | null;
};

const serviceIds = parseServiceIds(process.argv.slice(2));
const baseUrl = (process.env.DZN_APP_URL || "https://dzn-network.pages.dev").replace(/\/$/, "");
const cronSecret = process.env.DZN_CRON_SECRET || process.env.SYNC_CRON_SECRET || "";
const checks: Check[] = [];
const NOFTP_SOURCE_NAME = "gameserver_details_log_files_noftp_download";

function parseServiceIds(args: string[]) {
  const values = args.flatMap((arg) => arg.split(",")).map((arg) => arg.trim()).filter(Boolean);
  const ids = values.length ? values : ["17428528", "18765761"];
  return [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
}

function add(status: CheckStatus, title: string, detail: string, evidence?: unknown) {
  checks.push({ status, title, detail, evidence });
}

function pass(title: string, detail: string, evidence?: unknown) {
  add("pass", title, detail, evidence);
}

function warn(title: string, detail: string, evidence?: unknown) {
  add("warn", title, detail, evidence);
}

function fail(title: string, detail: string, evidence?: unknown) {
  add("fail", title, detail, evidence);
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function d1<T>(sql: string): T[] {
  const compactSql = sql.replace(/\s+/g, " ").trim();
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "dzn_network_db", "--remote", "--json", "--command", compactSql], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  if (result.error) {
    throw new Error(`wrangler d1 execute failed to start: ${safeText(result.error.message)}`);
  }
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed: ${safeText(result.stderr || result.stdout || "no output")}`);
  }
  const jsonStart = result.stdout.indexOf("[");
  const jsonEnd = result.stdout.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(`wrangler d1 execute did not return JSON: ${safeText(result.stdout)}`);
  }
  const parsed = JSON.parse(result.stdout.slice(jsonStart, jsonEnd + 1)) as Array<{ results?: T[]; success?: boolean }>;
  if (!Array.isArray(parsed) || parsed.some((entry) => entry.success === false)) {
    throw new Error("wrangler d1 execute returned an unsuccessful response.");
  }
  return parsed.flatMap((entry) => entry.results ?? []);
}

function shouldUseProtectedAdmHealthFallbackBeforeD1() {
  return process.env.GITHUB_ACTIONS === "true"
    && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID);
}

function parseAdmTimestamp(value: string | null | undefined) {
  const match = String(value ?? "").match(/DayZServer_PS4_x64_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.ADM/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function newerAdmFile(a: string | null | undefined, b: string | null | undefined) {
  const aTime = parseAdmTimestamp(a);
  const bTime = parseAdmTimestamp(b);
  if (aTime === null && bTime === null) return String(a ?? "").localeCompare(String(b ?? ""));
  if (aTime === null) return -1;
  if (bTime === null) return 1;
  return aTime - bTime;
}

function newestFile(rows: FileStateRow[]) {
  return [...rows].sort((a, b) => newerAdmFile(b.adm_file, a.adm_file))[0] ?? null;
}

function isOlderThan(value: string | null | undefined, minutes: number) {
  const time = Date.parse(String(value ?? ""));
  return !Number.isFinite(time) || Date.now() - time > minutes * 60 * 1000;
}

function isFuture(value: string | null | undefined) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) && time > Date.now();
}

async function fetchWithRetry(url: string, init?: RequestInit) {
  let last: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      last = await fetch(url, init);
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      continue;
    }
    if (![502, 503, 504].includes(last.status)) return last;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  return last!;
}

function hasCurrentCursor(file: FileStateRow | null, jobs: JobRow[]) {
  if (!file) return false;
  const cursor = Math.max(Number(file.cursor_line ?? 0), Number(file.imported_line_count ?? 0), Number(file.line_count ?? 0));
  const matchingJob = jobs.find((job) => job.filename === file.adm_file && job.source === "scheduled_nitrado");
  return cursor > 0
    || ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable", "completed", "completed_with_warnings"].includes(String(matchingJob?.status ?? ""))
    || ["caught_up_waiting_for_growth", "processed", "queued"].includes(String(file.status ?? ""));
}

function hasCurrentFileStateEvidence(file: FileStateRow | null, jobs: JobRow[]) {
  if (!file) return false;
  if (hasCurrentCursor(file, jobs)) return true;
  const status = String(file.status ?? "").toLowerCase();
  return ["discovered", "unreadable", "failed_unreadable", "parser_error", "write_error", "partial"].includes(status);
}

function fileHasImportEvidence(file: FileStateRow, jobs: JobRow[]) {
  if (hasCurrentCursor(file, jobs)) return true;
  const status = String(file.status ?? "").toLowerCase();
  if (["unreadable", "failed_unreadable", "parser_error", "write_error", "partial"].includes(status)) {
    return Boolean(
      file.next_retry_at ||
      file.last_error ||
      file.last_http_status ||
      Number(file.retry_count ?? 0) > 0 ||
      Number(file.latest_known_line_count ?? 0) > 0 ||
      Number(file.line_count ?? 0) > 0,
    );
  }
  return false;
}

function scheduledJobForFile(file: FileStateRow, jobs: JobRow[]) {
  return jobs.find((job) => job.filename === file.adm_file && job.source === "scheduled_nitrado") ?? null;
}

function hasActiveOrderedBackfill(file: FileStateRow, jobs: JobRow[]) {
  const job = scheduledJobForFile(file, jobs);
  const status = String(job?.status ?? "").toLowerCase();
  if (["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable"].includes(status)) return true;
  return isFuture(file.next_retry_at);
}

function fileHasNoftpEvidence(file: FileStateRow | null | undefined) {
  const combined = `${file?.adm_path ?? ""} ${file?.last_endpoint_kind ?? ""} ${file?.last_method ?? ""}`;
  return /\/noftp\//i.test(combined) || /gameserver_details|game_details/i.test(combined);
}

function noftpSourceEvidenceFromFiles(files: FileStateRow[], jobs: JobRow[], latestFile: FileStateRow | null) {
  const candidates = [...files]
    .filter((file) => fileHasNoftpEvidence(file))
    .sort((left, right) => newerAdmFile(right.adm_file, left.adm_file));
  const current = latestFile && fileHasNoftpEvidence(latestFile) ? latestFile : null;
  const evidenceFile = current ?? candidates.find((file) => hasCurrentFileStateEvidence(file, jobs)) ?? candidates[0] ?? null;
  if (!evidenceFile) return null;
  const job = scheduledJobForFile(evidenceFile, jobs);
  return {
    file: evidenceFile.adm_file,
    fileStatus: evidenceFile.status,
    pathKind: /\/noftp\//i.test(String(evidenceFile.adm_path ?? "")) ? "noftp" : null,
    endpointKind: evidenceFile.last_endpoint_kind,
    method: evidenceFile.last_method,
    cursorLine: evidenceFile.cursor_line,
    importedLineCount: evidenceFile.imported_line_count,
    latestKnownLineCount: evidenceFile.latest_known_line_count,
    jobStatus: job?.status ?? null,
  };
}

function noftpDiscoveryRecoverableEvidence(sources: SourceStateRow[], files: FileStateRow[], jobs: JobRow[], latestFile: FileStateRow | null) {
  const logFilesSource = sources.find((source) => source.source_name === "gameserver_details_log_files" && Number(source.works ?? 0) === 1);
  const noftp = sources.find((source) => source.source_name === NOFTP_SOURCE_NAME);
  if (!logFilesSource || !noftp || !isRecoverableDirectNoftpSource(noftp)) return null;
  const latestHasEvidence = latestFile ? hasCurrentFileStateEvidence(latestFile, jobs) || isFuture(latestFile.next_retry_at) : false;
  const recentScheduledJob = jobs.find((job) => job.source === "scheduled_nitrado" && (isCompletedJobStatus(job.status) || isActiveJobStatus(job.status))) ?? null;
  if (!latestHasEvidence && !recentScheduledJob) return null;
  return {
    logFilesSource,
    noftpSourceState: noftp,
    latestFile: latestFile ? {
      file: latestFile.adm_file,
      status: latestFile.status,
      cursorLine: latestFile.cursor_line,
      importedLineCount: latestFile.imported_line_count,
      latestKnownLineCount: latestFile.latest_known_line_count,
      nextRetryAt: latestFile.next_retry_at,
      lastError: latestFile.last_error,
    } : null,
    latestJobSource: recentScheduledJob ? {
      file: recentScheduledJob.filename,
      source: recentScheduledJob.source,
      status: recentScheduledJob.status,
      currentLine: recentScheduledJob.current_line,
      totalLines: recentScheduledJob.total_lines,
      completedAt: recentScheduledJob.completed_at,
    } : null,
  };
}

function isRecoverableDirectNoftpSource(source: SourceStateRow) {
  const status = Number(source.last_http_status ?? 0);
  const code = String(source.last_error_code ?? "").toUpperCase();
  if (status === 401 || status === 403 || code === "NITRADO_UNAUTHORIZED" || code === "NITRADO_FORBIDDEN") return false;
  return isFuture(source.next_test_at) || status === 404 || status === 429 || status >= 500 || /NITRADO_UPSTREAM_DOWN|NITRADO_RATE_LIMITED|FETCH_TIMEOUT|FETCH_THREW|WORKER_SUBREQUEST_LIMIT|NITRADO_FILE_NOT_FOUND/i.test(code);
}

function isCompletedJobStatus(status: string | null | undefined) {
  return /completed|completed_with_warnings|completed_empty|completed_no_new_events|completed_current|caught_up/i.test(String(status ?? ""));
}

function isActiveJobStatus(status: string | null | undefined) {
  return /queued|processing|parsing|writing|rebuilding|failed_retryable/i.test(String(status ?? ""));
}

async function checkProtectedEndpoints() {
  for (const path of ["/api/debug/nitrado-admin-logs", "/api/debug/nitrado-file-read", "/api/sync/adm/retry-unreadable", "/api/sync/adm/run", "/api/autodev/adm-health"]) {
    try {
      const response = await fetchWithRetry(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) pass(`POST ${path} unauthenticated`, "Protected endpoint returned 401.");
      else fail(`POST ${path} unauthenticated`, `Expected 401, got HTTP ${response.status}.`);
    } catch (error) {
      fail(`POST ${path} unauthenticated`, error instanceof Error ? error.message : String(error));
    }
  }
}

type PublicJson = Record<string, unknown> & {
  ok?: boolean;
  source?: string;
  fallback_reason?: string;
  totals?: Record<string, unknown>;
  topServers?: unknown[];
};

async function requestPublicJson(path: string) {
  const response = await fetchWithRetry(`${baseUrl}${path}`);
  const body = await response.text();
  let json: PublicJson | null = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  return { status: response.status, body: safeText(body), json };
}

async function checkPublicHomeStatsConsistency(hasPermanentAdmData: boolean) {
  const result = await requestPublicJson("/api/public/home-stats");
  if (result.status !== 200 || !result.json?.ok) {
    fail("public home-stats", `Expected public home-stats 200 JSON, got HTTP ${result.status}.`, result);
    return;
  }
  if (hasPermanentAdmData && (result.json.source === "empty_no_cache" || result.json.source === "fallback_empty" || result.json.fallback_reason === "live_query_failed_no_snapshot")) {
    fail("public home-stats ADM fallback", "Permanent ADM data exists but public home-stats is still reporting an empty/no-cache first-sync state.", {
      source: result.json.source,
      fallback_reason: result.json.fallback_reason,
    });
    return;
  }
  const totals = result.json.totals ?? {};
  const hasPublicAdmEvidence = Number(totals.statsActiveServers ?? 0) > 0
    || Number(totals.killsTracked ?? 0) > 0
    || Number(totals.joinsTracked ?? 0) > 0
    || Number(totals.totalEventsTracked ?? result.json.totalEventsTracked ?? 0) > 0
    || Number(totals.recentEventsCount ?? 0) > 0
    || (Array.isArray(result.json.topServers) && result.json.topServers.length > 0);
  if (hasPermanentAdmData && !hasPublicAdmEvidence) {
    fail("public home-stats ADM evidence", "Permanent ADM data exists but public home-stats does not expose last-known ADM evidence.", { totals });
    return;
  }
  pass("public home-stats", "Public home-stats returns last-known ADM data instead of first-sync waiting state.", {
    source: result.json.source,
    totals,
  });
}

type AdmHealthService = {
  serviceId: string | null;
  serverName?: string | null;
  currentPlayers?: number | null;
  maxPlayers?: number | null;
  metadataLastCheckedAt?: string | null;
  playerCountLastCheckedAt?: string | null;
  lastWorkerSelectedAt?: string | null;
  lastSelectionReason?: string | null;
  latestAdmFile?: string | null;
  nextRetryAt?: string | null;
  importJobStatus?: string | null;
  lastSuccessfulImportAt?: string | null;
  recentEventCount?: number | null;
  activeImportJob?: { status?: string | null; updatedAt?: string | null; currentLine?: number | null; totalLines?: number | null } | null;
  sourceMatrix?: Array<{
    sourceName?: string | null;
    works?: boolean;
    preferred?: boolean;
    nextTestAt?: string | null;
    lastHttpStatus?: number | null;
    lastStatus?: string | null;
    lastErrorCode?: string | null;
  }>;
  latestFileState?: {
    fileName?: string | null;
    status?: string | null;
    cursorLine?: number | null;
    importedLineCount?: number | null;
    lineCount?: number | null;
    latestKnownLineCount?: number | null;
    nextRetryAt?: string | null;
    lastHttpStatus?: number | null;
    lastEndpointKind?: string | null;
    lastMethod?: string | null;
    retryCount?: number | null;
    lastError?: string | null;
  } | null;
};

type AdmHealth = {
  ok?: boolean;
  worker?: { heartbeatAgeSeconds?: number | null; heartbeatState?: string | null; updatedAt?: string | null };
  services?: AdmHealthService[];
};

async function fetchAdmHealth() {
  if (!cronSecret) throw new Error("wrangler D1 query failed and no DZN_CRON_SECRET/SYNC_CRON_SECRET is available for ADM health fallback.");
  const response = await fetchWithRetry(`${baseUrl}/api/autodev/adm-health`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${cronSecret}`,
      "x-dzn-cron-secret": cronSecret,
      "x-sync-cron-secret": cronSecret,
      "x-cron-secret": cronSecret,
    },
    body: "{}",
  });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`ADM health fallback returned HTTP ${response.status}: ${safeText(body)}`);
  const json = JSON.parse(body) as AdmHealth;
  if (!json.ok) throw new Error("ADM health fallback returned ok=false.");
  return json;
}

async function verifyFromAdmHealth() {
  const health = await fetchAdmHealth();
  let hasPermanentAdmData = false;
  const heartbeatAge = Number(health.worker?.heartbeatAgeSeconds ?? Number.POSITIVE_INFINITY);
  if (health.worker?.heartbeatState === "stale" || heartbeatAge > 15 * 60) {
    fail("ADM Worker heartbeat", "Heartbeat is stale in ADM health fallback.", health.worker);
  } else {
    pass("ADM Worker heartbeat", "Heartbeat is fresh in ADM health fallback.", health.worker);
  }

  for (const serviceId of serviceIds) {
    const service = (health.services ?? []).find((candidate) => candidate.serviceId === serviceId);
    if (!service) {
      fail(`service ${serviceId}`, "Service missing from ADM health fallback.");
      continue;
    }
    const label = `${service.serverName ?? serviceId} (${serviceId})`;
    const serviceEvidence = getHealthServiceEvidence(service);
    if (isOlderThan(service.metadataLastCheckedAt ?? service.playerCountLastCheckedAt, 30)) {
      if (serviceEvidence) {
        warn(label, `Nitrado metadata/player count is older than 30 minutes, but protected ADM health has current evidence: ${serviceEvidence}.`, {
          metadataLastCheckedAt: service.metadataLastCheckedAt,
          playerCountLastCheckedAt: service.playerCountLastCheckedAt,
        });
      } else {
        fail(label, "Nitrado metadata/player count is older than 30 minutes and no current ADM job/cursor/retry evidence was found.", {
          metadataLastCheckedAt: service.metadataLastCheckedAt,
          playerCountLastCheckedAt: service.playerCountLastCheckedAt,
        });
      }
    } else {
      pass(label, `Metadata is fresh enough. Current players ${Number(service.currentPlayers ?? 0)} / ${Number(service.maxPlayers ?? 0)}.`);
    }
    if (isOlderThan(service.lastWorkerSelectedAt, 30)) {
      if (serviceEvidence) {
        warn(label, `ADM Worker selection is older than 30 minutes, but protected ADM health has current evidence: ${serviceEvidence}.`, {
          lastWorkerSelectedAt: service.lastWorkerSelectedAt,
          lastSelectionReason: service.lastSelectionReason,
        });
      } else {
        fail(label, "ADM Worker has not selected this service within 30 minutes and no current ADM job/cursor/retry evidence was found.", {
          lastWorkerSelectedAt: service.lastWorkerSelectedAt,
          lastSelectionReason: service.lastSelectionReason,
        });
      }
    } else {
      pass(label, `Worker selected service recently for ${service.lastSelectionReason ?? "unknown reason"}.`);
    }
    const noftp = service.sourceMatrix?.find((source) => source.sourceName === NOFTP_SOURCE_NAME);
    const noftpHealthEvidence = getHealthNoftpEvidence(service);
    if (noftp?.works && noftp.preferred) {
      pass(label, "Nitrado Log Files/noftp source is preferred and working.", noftp);
    } else if (noftp?.lastHttpStatus === 429 && isFuture(noftp.nextTestAt)) {
      pass(label, "Nitrado noftp source is rate-limited with future automatic retry.", noftp);
    } else if (noftpHealthEvidence) {
      pass(label, "Nitrado Log Files/noftp source is backed by current ADM health evidence.", noftpHealthEvidence);
    } else {
      fail(label, "No working preferred noftp source is recorded in ADM health.", {
        serviceId,
        serverName: service.serverName ?? null,
        latestAdm: service.latestAdmFile ?? service.latestFileState?.fileName ?? null,
        sourceStateRows: service.sourceMatrix ?? [],
        latestFileStateSource: service.latestFileState ? {
          file: service.latestFileState.fileName,
          endpointKind: service.latestFileState.lastEndpointKind,
          method: service.latestFileState.lastMethod,
          status: service.latestFileState.status,
          cursorLine: service.latestFileState.cursorLine,
          importedLineCount: service.latestFileState.importedLineCount,
          latestKnownLineCount: service.latestFileState.latestKnownLineCount,
        } : null,
        latestJobSource: {
          status: service.importJobStatus ?? null,
          activeJobStatus: service.activeImportJob?.status ?? null,
          lastSuccessfulImportAt: service.lastSuccessfulImportAt ?? null,
        },
        expectedSourceKeys: [NOFTP_SOURCE_NAME],
      });
    }
    const fileState = service.latestFileState ?? null;
    const cursor = Math.max(Number(fileState?.cursorLine ?? 0), Number(fileState?.importedLineCount ?? 0), Number(fileState?.lineCount ?? 0));
    if (service.lastSuccessfulImportAt || cursor > 0 || Number(service.recentEventCount ?? 0) > 0) hasPermanentAdmData = true;
    if (service.activeImportJob || cursor > 0 || ["caught_up_waiting_for_growth", "processed", "queued", "discovered"].includes(String(fileState?.status ?? "")) || healthFileHasDurableAttemptEvidence(fileState)) {
      pass(label, `Current ADM has scheduled job/cursor evidence for ${fileState?.fileName ?? service.latestAdmFile ?? "latest ADM"}.`, {
        importJobStatus: service.importJobStatus,
        fileStatus: fileState?.status,
        cursor,
      });
    } else if (isFuture(fileState?.nextRetryAt ?? service.nextRetryAt)) {
      pass(label, `Current ADM read is blocked with retry scheduled for ${fileState?.nextRetryAt ?? service.nextRetryAt}.`, {
        httpStatus: fileState?.lastHttpStatus,
      });
    } else {
      fail(label, "No scheduled_nitrado job or caught-up cursor exists for current ADM.", {
        latestAdmFile: service.latestAdmFile,
        importJobStatus: service.importJobStatus,
        latestFileState: fileState,
      });
    }
  }
  await checkPublicHomeStatsConsistency(hasPermanentAdmData);
}

function getHealthServiceEvidence(service: AdmHealthService) {
  const fileState = service.latestFileState ?? null;
  const cursor = Math.max(Number(fileState?.cursorLine ?? 0), Number(fileState?.importedLineCount ?? 0), Number(fileState?.lineCount ?? 0));
  const noftp = service.sourceMatrix?.find((source) => source.sourceName === NOFTP_SOURCE_NAME);
  if (noftp?.works && noftp.preferred && cursor > 0) return `noftp preferred with cursor ${cursor}`;
  if (service.activeImportJob && !isTerminalHealthImportJob(service.activeImportJob)) return `active job ${service.activeImportJob.status ?? "unknown"}`;
  if (healthFileHasDurableAttemptEvidence(fileState)) return `durable file-state evidence for ${fileState?.fileName ?? "latest ADM"}`;
  if (service.lastSuccessfulImportAt || service.recentEventCount || service.importJobStatus === "completed_with_warnings") return "successful import history";
  if (isFuture(fileState?.nextRetryAt ?? service.nextRetryAt)) return `retry scheduled for ${fileState?.nextRetryAt ?? service.nextRetryAt}`;
  return null;
}

function getHealthNoftpEvidence(service: AdmHealthService) {
  const noftp = service.sourceMatrix?.find((source) => source.sourceName === NOFTP_SOURCE_NAME);
  const fileState = service.latestFileState ?? null;
  const cursor = Math.max(
    Number(fileState?.cursorLine ?? 0),
    Number(fileState?.importedLineCount ?? 0),
    Number(fileState?.lineCount ?? 0),
    Number(fileState?.latestKnownLineCount ?? 0),
  );
  const fileHasNoftp = healthFileHasNoftpEvidence(fileState);
  const retryAt = fileState?.nextRetryAt ?? service.nextRetryAt ?? noftp?.nextTestAt ?? null;
  const serviceEvidence = getHealthServiceEvidence(service);
  const sourceRecoverable = Boolean(noftp && !isAuthNoftpFailure(noftp) && (isFuture(noftp.nextTestAt) || Number(noftp.lastHttpStatus ?? 0) >= 500 || isRecoverableNoftpError(noftp.lastErrorCode)));
  if (fileHasNoftp && (cursor > 0 || service.activeImportJob || service.lastSuccessfulImportAt || isFuture(retryAt) || healthFileHasDurableAttemptEvidence(fileState))) {
    return {
      sourceState: noftp ?? null,
      fileEvidence: {
        file: fileState?.fileName ?? service.latestAdmFile ?? null,
        status: fileState?.status ?? null,
        endpointKind: fileState?.lastEndpointKind ?? null,
        method: fileState?.lastMethod ?? null,
        cursorLine: fileState?.cursorLine ?? null,
        importedLineCount: fileState?.importedLineCount ?? null,
        latestKnownLineCount: fileState?.latestKnownLineCount ?? null,
        retryAt,
      },
    };
  }
  if (sourceRecoverable && serviceEvidence) {
    return {
      sourceState: noftp ?? null,
      serviceEvidence,
      retryAt,
    };
  }
  return null;
}

function healthFileHasDurableAttemptEvidence(file: AdmHealthService["latestFileState"]) {
  if (!file) return false;
  const status = String(file.status ?? "").toLowerCase();
  if (!["unreadable", "failed_unreadable", "parser_error", "write_error", "partial"].includes(status)) return false;
  return Boolean(
    file.nextRetryAt ||
    file.lastError ||
    Number(file.lastHttpStatus ?? 0) > 0 ||
    Number(file.retryCount ?? 0) > 0 ||
    Number(file.latestKnownLineCount ?? 0) > 0 ||
    Number(file.lineCount ?? 0) > 0,
  );
}

function healthFileHasNoftpEvidence(file: AdmHealthService["latestFileState"]) {
  const combined = `${file?.lastEndpointKind ?? ""} ${file?.lastMethod ?? ""}`;
  return /gameserver_details|game_details/i.test(combined);
}

function isAuthNoftpFailure(source: NonNullable<AdmHealthService["sourceMatrix"]>[number]) {
  const status = Number(source.lastHttpStatus ?? 0);
  const code = String(source.lastErrorCode ?? "").toUpperCase();
  return status === 401 || status === 403 || code === "NITRADO_UNAUTHORIZED" || code === "NITRADO_FORBIDDEN";
}

function isRecoverableNoftpError(value: string | null | undefined) {
  return /NITRADO_UPSTREAM_DOWN|NITRADO_RATE_LIMITED|FETCH_TIMEOUT|FETCH_THREW|WORKER_SUBREQUEST_LIMIT|NITRADO_FILE_NOT_FOUND/i.test(String(value ?? ""));
}

function isTerminalHealthImportJob(job: AdmHealthService["activeImportJob"]) {
  const total = Number(job?.totalLines ?? 0);
  return total > 0 && Number(job?.currentLine ?? 0) >= total && /rebuilding|failed_retryable/i.test(String(job?.status ?? ""));
}

function safeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").replace(/[A-Za-z0-9._~+/=-]{80,}/g, "REDACTED").slice(0, 500);
}

function report() {
  const reportDir = ".autodev/reports";
  mkdirSync(reportDir, { recursive: true });
  const summary = {
    ok: checks.every((check) => check.status !== "fail"),
    generatedAt: new Date().toISOString(),
    serviceIds,
    checks,
  };
  writeFileSync(`${reportDir}/adm-live.json`, JSON.stringify(summary, null, 2));
  const lines = [
    "# ADM Live Production Verification",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "| Status | Check | Detail |",
    "|---|---|---|",
    ...checks.map((check) => `| ${check.status.toUpperCase()} | ${check.title.replace(/\|/g, "/")} | ${check.detail.replace(/\|/g, "/")} |`),
    "",
  ];
  writeFileSync(`${reportDir}/adm-live.md`, lines.join("\n"));
  for (const check of checks) {
    console.log(`${check.status.toUpperCase()} ${check.title}: ${check.detail}`);
  }
  if (!summary.ok) process.exitCode = 1;
}

async function main() {
  if (!serviceIds.length) throw new Error("No valid service ids were provided.");
  const inClause = serviceIds.map(sqlString).join(", ");
  let linkedServers: LinkedServerRow[];
  if (shouldUseProtectedAdmHealthFallbackBeforeD1()) {
    warn(
      "production D1 query fallback",
      "Remote D1 query unavailable; using protected ADM health fallback. CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID are not configured for this GitHub Actions run.",
    );
    await verifyFromAdmHealth();
    await checkProtectedEndpoints();
    report();
    return;
  }
  try {
    linkedServers = d1<LinkedServerRow>(`
    SELECT linked_servers.id AS id,
           linked_servers.display_name AS display_name,
           linked_servers.hostname AS hostname,
           linked_servers.server_name AS server_name,
           linked_servers.nitrado_service_id AS nitrado_service_id,
           server_subscriptions.plan_key,
           server_subscriptions.status AS subscription_status,
           linked_servers.current_players,
           linked_servers.max_players,
           linked_servers.player_count_last_checked_at,
           linked_servers.metadata_last_checked_at,
           adm_sync_state.latest_adm_file,
           adm_sync_state.last_processed_file,
           adm_sync_state.last_sync_status,
           adm_sync_state.last_sync_message,
           selection.last_worker_selected_at,
           selection.selected_count,
           selection.last_selection_reason,
           rate_limits.rate_limited_until
    FROM linked_servers
    LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
    LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
    LEFT JOIN adm_worker_selection_state selection ON selection.linked_server_id = linked_servers.id
    LEFT JOIN nitrado_rate_limits rate_limits ON rate_limits.service_id = linked_servers.nitrado_service_id
    WHERE linked_servers.nitrado_service_id IN (${inClause})
    ORDER BY linked_servers.nitrado_service_id
  `);
  } catch (error) {
    warn("production D1 query fallback", `Remote D1 query unavailable; using protected ADM health fallback. ${error instanceof Error ? safeText(error.message) : "unknown error"}`);
    await verifyFromAdmHealth();
    await checkProtectedEndpoints();
    report();
    return;
  }
  const fileStates = d1<FileStateRow>(`
    SELECT linked_server_id, source_service_id, adm_file, adm_path, status, line_count,
           latest_known_line_count, imported_line_count, cursor_line, last_read_at,
           last_growth_at, last_endpoint_kind, last_method, next_retry_at, last_http_status, last_error, retry_count
    FROM adm_sync_file_state
    WHERE source_service_id IN (${inClause})
      AND ignored_at IS NULL
    ORDER BY source_service_id, adm_file DESC
    LIMIT 500
  `);
  const linkedServerIds = linkedServers
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const jobs = d1<JobRow>(`
    SELECT server_id, source_service_id, filename, source, status, current_line, total_lines,
           chunks_processed, total_chunks, parsed_kills, written_kills, joins, disconnects,
           playerlist_snapshots, updated_at, completed_at
    FROM adm_import_jobs
    WHERE source_service_id IN (${inClause}) OR server_id IN (${linkedServerIds.map(sqlString).join(", ") || "''"})
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 300
  `);
  const sources = d1<SourceStateRow>(`
    SELECT service_id, source_name, last_tested_at, last_status, last_http_status,
           last_error_code, works, preferred, next_test_at
    FROM adm_live_source_state
    WHERE service_id IN (${inClause})
    ORDER BY service_id, preferred DESC, works DESC, COALESCE(last_tested_at, updated_at) DESC
  `);
  const heartbeat = d1<{ updated_at: string | null; last_status: string | null; last_error_code: string | null }>(`
    SELECT updated_at, last_status, last_error_code
    FROM adm_worker_heartbeat
    WHERE worker_name = 'dzn-adm-sync-worker'
    LIMIT 1
  `)[0] ?? null;

  if (!heartbeat || isOlderThan(heartbeat.updated_at, 15)) {
    fail("ADM Worker heartbeat", "Heartbeat is missing or older than 15 minutes.", heartbeat);
  } else {
    pass("ADM Worker heartbeat", `Fresh heartbeat at ${heartbeat.updated_at}.`, heartbeat);
  }

  let permanentAdmDataDetected = false;
  for (const serviceId of serviceIds) {
    const server = linkedServers.find((row) => row.nitrado_service_id === serviceId);
    if (!server) {
      fail(`service ${serviceId}`, "No linked server row found in production D1.");
      continue;
    }
    const label = `${server.display_name ?? server.hostname ?? server.server_name ?? serviceId} (${serviceId})`;
    const activePlan = ["active", "trialing"].includes(String(server.subscription_status ?? "").toLowerCase());
    if (!activePlan) {
      warn(label, `Subscription state is ${server.subscription_status ?? "unknown"}; skipping active tracking freshness gates.`);
      continue;
    }
    if (isOlderThan(server.metadata_last_checked_at ?? server.player_count_last_checked_at, 30)) {
      fail(label, "Nitrado metadata/player count is older than 30 minutes.", {
        metadataLastCheckedAt: server.metadata_last_checked_at,
        playerCountLastCheckedAt: server.player_count_last_checked_at,
      });
    } else {
      pass(label, `Metadata is fresh enough. Current players ${Number(server.current_players ?? 0)} / ${Number(server.max_players ?? 0)}.`);
    }
    const serviceSources = sources.filter((source) => source.service_id === serviceId);
    const serviceFiles = fileStates.filter((row) => row.source_service_id === serviceId || row.linked_server_id === server.id);
    const latestFile = newestFile(serviceFiles);
    const serviceJobs = jobs.filter((job) => job.server_id === server.id || job.source_service_id === serviceId);
    const noftp = serviceSources.find((source) => source.source_name === NOFTP_SOURCE_NAME);
    const noftpFileEvidence = noftpSourceEvidenceFromFiles(serviceFiles, serviceJobs, latestFile);
    const noftpDiscoveryRetryEvidence = noftpDiscoveryRecoverableEvidence(serviceSources, serviceFiles, serviceJobs, latestFile);
    const workerSelectionEvidence = latestFile && (hasCurrentFileStateEvidence(latestFile, serviceJobs) || isFuture(latestFile.next_retry_at))
      ? `current ADM evidence for ${latestFile.adm_file}`
      : noftpFileEvidence
        ? `noftp file evidence for ${noftpFileEvidence.file}`
        : noftpDiscoveryRetryEvidence
          ? `recoverable noftp evidence for ${noftpDiscoveryRetryEvidence.latestFile?.file ?? latestFile?.adm_file ?? "latest ADM"}`
          : null;
    if (isOlderThan(server.last_worker_selected_at, 30)) {
      if (workerSelectionEvidence) {
        warn(label, `ADM Worker selection is older than 30 minutes, but D1 has ${workerSelectionEvidence}.`, {
          lastWorkerSelectedAt: server.last_worker_selected_at,
          lastSelectionReason: server.last_selection_reason,
        });
      } else {
        fail(label, "ADM Worker has not selected this service within 30 minutes and no current ADM job/cursor/retry evidence was found.", {
          lastWorkerSelectedAt: server.last_worker_selected_at,
          lastSelectionReason: server.last_selection_reason,
        });
      }
    } else {
      pass(label, `Worker selected service recently for ${server.last_selection_reason ?? "unknown reason"}.`);
    }
    if (noftp?.works === 1 && noftp.preferred !== 1) {
      fail(label, "Nitrado noftp source works but is not preferred.", noftp);
    } else if (noftp?.works === 1) {
      pass(label, "Nitrado Log Files/noftp source is preferred and working.", {
        lastTestedAt: noftp.last_tested_at,
        status: noftp.last_status,
      });
    } else if (noftpFileEvidence) {
      pass(label, "Nitrado Log Files/noftp source is backed by current file-state/job evidence.", {
        sourceState: noftp ?? null,
        fileEvidence: noftpFileEvidence,
      });
    } else if (noftpDiscoveryRetryEvidence) {
      pass(label, "Nitrado Log Files/noftp discovery is working and current noftp read has recoverable evidence.", noftpDiscoveryRetryEvidence);
    } else if (isFuture(server.rate_limited_until) || serviceSources.some((source) => source.last_http_status === 429 && isFuture(source.next_test_at))) {
      pass(label, "Nitrado reads are rate-limited with future automatic retry.", {
        rateLimitedUntil: server.rate_limited_until,
      });
    } else {
      fail(label, "No working noftp live source is recorded for this service.", {
        serviceId,
        serverName: server.display_name ?? server.hostname ?? server.server_name ?? null,
        latestAdm: latestFile?.adm_file ?? server.latest_adm_file ?? null,
        sourceStateRows: serviceSources,
        latestJobSource: serviceJobs[0] ? {
          file: serviceJobs[0].filename,
          source: serviceJobs[0].source,
          status: serviceJobs[0].status,
        } : null,
        latestFileStateSource: latestFile ? {
          file: latestFile.adm_file,
          path: latestFile.adm_path,
          endpointKind: latestFile.last_endpoint_kind,
          method: latestFile.last_method,
          status: latestFile.status,
        } : null,
        expectedSourceKeys: [NOFTP_SOURCE_NAME],
      });
    }
    if (!latestFile) {
      fail(label, "No ADM file state rows exist for this service.");
      continue;
    }
    if (server.latest_adm_file && newerAdmFile(latestFile.adm_file, server.latest_adm_file) > 0) {
      fail(label, `adm_sync_state.latest_adm_file is stale. Newest file state is ${latestFile.adm_file}.`, {
        latestAdmFile: server.latest_adm_file,
        newestFileState: latestFile.adm_file,
      });
    } else {
      pass(label, `Latest ADM state points at ${server.latest_adm_file ?? latestFile.adm_file}.`);
    }

    const currentJob = serviceJobs.find((job) => job.filename === latestFile.adm_file && job.source === "scheduled_nitrado");
    const lastProcessedTime = parseAdmTimestamp(server.last_processed_file);
    const recentFilesAfterLastProcessed = [...serviceFiles]
      .filter((file) => {
        const fileTime = parseAdmTimestamp(file.adm_file);
        return fileTime !== null && (lastProcessedTime === null || fileTime > lastProcessedTime);
      })
      .sort((left, right) => newerAdmFile(left.adm_file, right.adm_file));
    const skippedIntermediateFiles = recentFilesAfterLastProcessed.filter((file) => {
      if (file.adm_file === latestFile.adm_file) return false;
      return !fileHasImportEvidence(file, serviceJobs) && !isFuture(file.next_retry_at);
    });
    const activeOrderedBackfillFiles = recentFilesAfterLastProcessed
      .filter((file) => file.adm_file !== latestFile.adm_file)
      .filter((file) => hasActiveOrderedBackfill(file, serviceJobs));
    if (skippedIntermediateFiles.length) {
      fail(label, "Recent noftp ADM files newer than the last completed import lack job/cursor evidence before the current latest ADM.", skippedIntermediateFiles.map((file) => ({
        file: file.adm_file,
        status: file.status,
        cursorLine: file.cursor_line,
        importedLineCount: file.imported_line_count,
        latestKnownLineCount: file.latest_known_line_count,
        nextRetryAt: file.next_retry_at,
        lastHttpStatus: file.last_http_status,
        retryCount: file.retry_count,
        lastError: safeText(file.last_error ?? ""),
      })));
    } else if (recentFilesAfterLastProcessed.length > 1) {
      pass(label, "Recent ADM files after the last processed file have import/cursor evidence or retry state in timestamp order.", {
        files: recentFilesAfterLastProcessed.map((file) => file.adm_file),
      });
    }
    if (serviceJobs.some((job) => job.source === "scheduled_nitrado" && /completed/i.test(job.status)) || Math.max(Number(latestFile.cursor_line ?? 0), Number(latestFile.imported_line_count ?? 0), Number(latestFile.line_count ?? 0)) > 0) {
      permanentAdmDataDetected = true;
    }
    if (hasCurrentFileStateEvidence(latestFile, serviceJobs)) {
      pass(label, `Current ADM has file-state/job/cursor evidence for ${latestFile.adm_file}.`, {
        fileStatus: latestFile.status,
        cursorLine: latestFile.cursor_line,
        importedLineCount: latestFile.imported_line_count,
        jobStatus: currentJob?.status ?? null,
        jobProgress: currentJob ? `${currentJob.current_line ?? 0}/${currentJob.total_lines ?? 0}` : null,
      });
    } else if (activeOrderedBackfillFiles.length > 0) {
      pass(label, `Current newest ADM ${latestFile.adm_file} is waiting behind active ordered recent backfill.`, {
        currentFileStatus: latestFile.status,
        activeBackfillFiles: activeOrderedBackfillFiles.map((file) => {
          const job = scheduledJobForFile(file, serviceJobs);
          return {
            file: file.adm_file,
            fileStatus: file.status,
            jobStatus: job?.status ?? null,
            jobProgress: job ? `${job.current_line ?? 0}/${job.total_lines ?? 0}` : null,
            nextRetryAt: file.next_retry_at,
          };
        }),
      });
    } else if (isFuture(latestFile.next_retry_at)) {
      pass(label, `Current ADM read is blocked with retry scheduled for ${latestFile.next_retry_at}.`, {
        file: latestFile.adm_file,
        httpStatus: latestFile.last_http_status,
      });
    } else {
      fail(label, `No scheduled_nitrado job or caught-up cursor exists for current ADM ${latestFile.adm_file}.`, {
        fileStatus: latestFile.status,
        httpStatus: latestFile.last_http_status,
        lastError: safeText(latestFile.last_error ?? ""),
      });
    }
  }

  await checkProtectedEndpoints();
  await checkPublicHomeStatsConsistency(permanentAdmDataDetected);
  report();
}

main().catch((error) => {
  fail("verify:adm-live exception", error instanceof Error ? (error.stack ?? error.message) : String(error));
  report();
  process.exit(1);
});
