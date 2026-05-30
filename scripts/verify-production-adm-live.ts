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
  status: string | null;
  line_count: number | null;
  latest_known_line_count: number | null;
  imported_line_count: number | null;
  cursor_line: number | null;
  last_read_at: string | null;
  last_growth_at: string | null;
  next_retry_at: string | null;
  last_http_status: number | null;
  last_error: string | null;
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
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, ["wrangler", "d1", "execute", "dzn_network_db", "--remote", "--json", "--command", sql], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed: ${safeText(result.stderr || result.stdout)}`);
  }
  const parsed = JSON.parse(result.stdout) as Array<{ results?: T[]; success?: boolean }>;
  if (!Array.isArray(parsed) || parsed.some((entry) => entry.success === false)) {
    throw new Error("wrangler d1 execute returned an unsuccessful response.");
  }
  return parsed.flatMap((entry) => entry.results ?? []);
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

function hasCurrentCursor(file: FileStateRow | null, jobs: JobRow[]) {
  if (!file) return false;
  const cursor = Math.max(Number(file.cursor_line ?? 0), Number(file.imported_line_count ?? 0), Number(file.line_count ?? 0));
  const matchingJob = jobs.find((job) => job.filename === file.adm_file && job.source === "scheduled_nitrado");
  return cursor > 0
    || ["queued", "processing", "parsing", "writing", "rebuilding", "failed_retryable", "completed", "completed_with_warnings"].includes(String(matchingJob?.status ?? ""))
    || ["caught_up_waiting_for_growth", "processed", "queued"].includes(String(file.status ?? ""));
}

async function checkProtectedEndpoints() {
  for (const path of ["/api/debug/nitrado-admin-logs", "/api/debug/nitrado-file-read", "/api/sync/adm/retry-unreadable", "/api/sync/adm/run", "/api/autodev/adm-health"]) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
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
  activeImportJob?: { status?: string | null; updatedAt?: string | null } | null;
  sourceMatrix?: Array<{ sourceName?: string | null; works?: boolean; preferred?: boolean; nextTestAt?: string | null; lastHttpStatus?: number | null }>;
  latestFileState?: {
    fileName?: string | null;
    status?: string | null;
    cursorLine?: number | null;
    importedLineCount?: number | null;
    lineCount?: number | null;
    nextRetryAt?: string | null;
    lastHttpStatus?: number | null;
  } | null;
};

type AdmHealth = {
  ok?: boolean;
  worker?: { heartbeatAgeSeconds?: number | null; heartbeatState?: string | null; updatedAt?: string | null };
  services?: AdmHealthService[];
};

async function fetchAdmHealth() {
  if (!cronSecret) throw new Error("wrangler D1 query failed and no DZN_CRON_SECRET/SYNC_CRON_SECRET is available for ADM health fallback.");
  const response = await fetch(`${baseUrl}/api/autodev/adm-health`, {
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
    if (isOlderThan(service.metadataLastCheckedAt ?? service.playerCountLastCheckedAt, 30)) {
      fail(label, "Nitrado metadata/player count is older than 30 minutes.", {
        metadataLastCheckedAt: service.metadataLastCheckedAt,
        playerCountLastCheckedAt: service.playerCountLastCheckedAt,
      });
    } else {
      pass(label, `Metadata is fresh enough. Current players ${Number(service.currentPlayers ?? 0)} / ${Number(service.maxPlayers ?? 0)}.`);
    }
    if (isOlderThan(service.lastWorkerSelectedAt, 30)) {
      fail(label, "ADM Worker has not selected this service within 30 minutes.", {
        lastWorkerSelectedAt: service.lastWorkerSelectedAt,
        lastSelectionReason: service.lastSelectionReason,
      });
    } else {
      pass(label, `Worker selected service recently for ${service.lastSelectionReason ?? "unknown reason"}.`);
    }
    const noftp = service.sourceMatrix?.find((source) => source.sourceName === "gameserver_details_log_files_noftp_download");
    if (noftp?.works && noftp.preferred) {
      pass(label, "Nitrado Log Files/noftp source is preferred and working.", noftp);
    } else if (noftp?.lastHttpStatus === 429 && isFuture(noftp.nextTestAt)) {
      pass(label, "Nitrado noftp source is rate-limited with future automatic retry.", noftp);
    } else {
      fail(label, "No working preferred noftp source is recorded in ADM health.", service.sourceMatrix);
    }
    const fileState = service.latestFileState ?? null;
    const cursor = Math.max(Number(fileState?.cursorLine ?? 0), Number(fileState?.importedLineCount ?? 0), Number(fileState?.lineCount ?? 0));
    if (service.activeImportJob || cursor > 0 || ["caught_up_waiting_for_growth", "processed", "queued"].includes(String(fileState?.status ?? ""))) {
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
}

function safeText(value: string) {
  return value.replace(/\s+/g, " ").replace(/[A-Za-z0-9._~+/=-]{80,}/g, "REDACTED").slice(0, 500);
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
  try {
    linkedServers = d1<LinkedServerRow>(`
    SELECT linked_servers.id,
           linked_servers.display_name,
           linked_servers.hostname,
           linked_servers.server_name,
           linked_servers.nitrado_service_id,
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
    SELECT linked_server_id, source_service_id, adm_file, status, line_count,
           latest_known_line_count, imported_line_count, cursor_line, last_read_at,
           last_growth_at, next_retry_at, last_http_status, last_error
    FROM adm_sync_file_state
    WHERE source_service_id IN (${inClause})
      AND ignored_at IS NULL
    ORDER BY source_service_id, adm_file DESC
    LIMIT 80
  `);
  const jobs = d1<JobRow>(`
    SELECT server_id, source_service_id, filename, source, status, current_line, total_lines,
           chunks_processed, total_chunks, parsed_kills, written_kills, joins, disconnects,
           playerlist_snapshots, updated_at, completed_at
    FROM adm_import_jobs
    WHERE source_service_id IN (${inClause}) OR server_id IN (${linkedServers.map((row) => sqlString(row.id)).join(", ") || "''"})
    ORDER BY COALESCE(updated_at, created_at) DESC
    LIMIT 80
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
    if (isOlderThan(server.last_worker_selected_at, 30)) {
      fail(label, "ADM Worker has not selected this service within 30 minutes.", {
        lastWorkerSelectedAt: server.last_worker_selected_at,
        lastSelectionReason: server.last_selection_reason,
      });
    } else {
      pass(label, `Worker selected service recently for ${server.last_selection_reason ?? "unknown reason"}.`);
    }

    const serviceSources = sources.filter((source) => source.service_id === serviceId);
    const noftp = serviceSources.find((source) => source.source_name === "gameserver_details_log_files_noftp_download");
    if (noftp?.works === 1 && noftp.preferred !== 1) {
      fail(label, "Nitrado noftp source works but is not preferred.", noftp);
    } else if (noftp?.works === 1) {
      pass(label, "Nitrado Log Files/noftp source is preferred and working.", {
        lastTestedAt: noftp.last_tested_at,
        status: noftp.last_status,
      });
    } else if (isFuture(server.rate_limited_until) || serviceSources.some((source) => source.last_http_status === 429 && isFuture(source.next_test_at))) {
      pass(label, "Nitrado reads are rate-limited with future automatic retry.", {
        rateLimitedUntil: server.rate_limited_until,
      });
    } else {
      fail(label, "No working noftp live source is recorded for this service.", serviceSources);
    }

    const serviceFiles = fileStates.filter((row) => row.source_service_id === serviceId || row.linked_server_id === server.id);
    const latestFile = newestFile(serviceFiles);
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

    const serviceJobs = jobs.filter((job) => job.server_id === server.id || job.source_service_id === serviceId);
    const currentJob = serviceJobs.find((job) => job.filename === latestFile.adm_file && job.source === "scheduled_nitrado");
    if (hasCurrentCursor(latestFile, serviceJobs)) {
      pass(label, `Current ADM has scheduled job/cursor evidence for ${latestFile.adm_file}.`, {
        fileStatus: latestFile.status,
        cursorLine: latestFile.cursor_line,
        importedLineCount: latestFile.imported_line_count,
        jobStatus: currentJob?.status ?? null,
        jobProgress: currentJob ? `${currentJob.current_line ?? 0}/${currentJob.total_lines ?? 0}` : null,
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
  report();
}

main().catch((error) => {
  fail("verify:adm-live exception", error instanceof Error ? error.message : String(error));
  report();
  process.exit(1);
});
