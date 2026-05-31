import { fail, loadConfig, makeReport, pass, skip, warn, writeReport, type AutoDevCheck } from "./lib";
import { classifyRecoverableProductionStatus } from "./risk-classifier";

const config = loadConfig();
const baseUrl = (process.env.DZN_APP_URL || config.productionUrl).replace(/\/$/, "");
const cronSecret = process.env.DZN_CRON_SECRET || process.env.SYNC_CRON_SECRET || "";
const watchMinutes = Number(process.env.AUTODEV_WATCH_MINUTES ?? config.watchMinutesAfterDeploy);
const pollMs = Number(process.env.AUTODEV_WATCH_POLL_MS ?? 5 * 60 * 1000);

type AdmHealthService = {
  serviceId: string | null;
  lastSyncStatus: string | null;
  latestClassifiedError: string | null;
  latestHttpStatus?: number | null;
  nextRetryAt?: string | null;
  recoverable?: boolean;
  manualActionRequired?: boolean;
  importJobStatus: string | null;
  lastSuccessfulImportAt: string | null;
  lastProcessedFile: string | null;
  metadataLastCheckedAt?: string | null;
  playerCountLastCheckedAt?: string | null;
  lastWorkerSelectedAt?: string | null;
  sourceMatrix?: Array<{ sourceName?: string | null; works?: boolean; preferred?: boolean; nextTestAt?: string | null; lastHttpStatus?: number | null }>;
  latestFileState?: {
    fileName?: string | null;
    status?: string | null;
    lineCount?: number | null;
    importedLineCount?: number | null;
    cursorLine?: number | null;
    nextRetryAt?: string | null;
    lastHttpStatus?: number | null;
  } | null;
  activeImportJob?: { updatedAt?: string | null; status?: string | null } | null;
};

type AdmHealthSnapshot = {
  ok?: boolean;
  status?: string;
  summary?: { workerHeartbeatFresh?: boolean; fatalIssues?: number; recoverableIssues?: number };
  worker?: {
    heartbeat?: { created_at?: string | null } | null;
    updatedAt?: string | null;
    heartbeatAgeSeconds?: number | null;
    heartbeatFresh?: boolean;
    heartbeatState?: "fresh" | "warning" | "stale" | "missing";
    lastStatus?: string | null;
    lastErrorCode?: string | null;
    lastRecoverable?: boolean;
  };
  services?: AdmHealthService[];
  warnings?: string[];
  fatalErrors?: string[];
};

async function poll() {
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
  let json: AdmHealthSnapshot | null = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    // handled below
  }
  return { status: response.status, json, body };
}

async function main() {
  const checks: AutoDevCheck[] = [];
  const snapshots: unknown[] = [];
  if (!cronSecret) {
    const report = makeReport("adm-cycle-watch", [fail("cron secret", "DZN_CRON_SECRET or SYNC_CRON_SECRET is required for ADM health watch.", undefined, "high")], [
      "Set DZN_CRON_SECRET or SYNC_CRON_SECRET for protected ADM health checks.",
    ]);
    writeReport("adm-cycle-watch", report);
    process.exit(1);
  }

  const started = Date.now();
  const deadline = started + Math.max(0, watchMinutes) * 60 * 1000;
  let lastSnapshot: AdmHealthSnapshot | null = null;
  let fatal = false;

  do {
    const result = await poll();
    snapshots.push({ at: new Date().toISOString(), status: result.status, body: result.json ?? result.body.slice(0, 500) });
    if (result.status === 401 || result.status === 403) {
      checks.push(fail("adm health auth", `ADM health endpoint returned ${result.status}.`, undefined, "high"));
      fatal = true;
      break;
    }
    if (result.status >= 500) {
      checks.push(fail("adm health response", `Expected ADM health 200 JSON, got ${result.status}.`, result, "high"));
      fatal = true;
      break;
    }
    if (result.status !== 200 || !result.json?.ok) {
      checks.push(fail("adm health response", `Expected ADM health 200 JSON, got ${result.status}.`, result, "high"));
      fatal = true;
      break;
    }
    lastSnapshot = result.json;
    if (result.json.worker?.lastStatus === "fatal_error" && result.json.worker.lastRecoverable !== true) {
      checks.push(fail("worker heartbeat fatal", "ADM Worker heartbeat reports a fatal Worker status.", result.json.worker, "high"));
      fatal = true;
      break;
    }

    const heartbeatAgeSeconds = typeof result.json.worker?.heartbeatAgeSeconds === "number"
      ? result.json.worker.heartbeatAgeSeconds
      : heartbeatAgeSecondsFrom(result.json.worker?.updatedAt ?? result.json.worker?.heartbeat?.created_at ?? null);
    if (heartbeatAgeSeconds === null || result.json.worker?.heartbeatState === "missing") {
      checks.push(fail("worker heartbeat missing", "No ADM Worker heartbeat row was found.", result.json.worker, "high"));
      fatal = true;
      break;
    } else if (heartbeatAgeSeconds > 15 * 60 || result.json.worker?.heartbeatState === "stale") {
      checks.push(fail("worker heartbeat stale", "ADM Worker heartbeat is stale beyond threshold.", result.json.worker, "high"));
      fatal = true;
      break;
    } else if (heartbeatAgeSeconds > 10 * 60 || result.json.worker?.heartbeatState === "warning") {
      checks.push(warn("worker heartbeat aging", "ADM Worker heartbeat is older than 10 minutes but not yet stale.", result.json.worker, "medium"));
    } else {
      checks.push(pass("worker heartbeat", "ADM Worker heartbeat is fresh.", result.json.worker));
    }

    for (const service of result.json.services ?? []) {
      const status = String(service.lastSyncStatus ?? service.latestClassifiedError ?? "").toLowerCase();
      const classifiedError = String(service.latestClassifiedError ?? "").toLowerCase();
      if (isOlderThanMinutes(service.metadataLastCheckedAt ?? service.playerCountLastCheckedAt, 30)) {
        checks.push(fail(`service ${service.serviceId} metadata stale`, "Active ADM service metadata/player count is older than 30 minutes.", service, "high"));
        fatal = true;
        continue;
      }
      if (isOlderThanMinutes(service.lastWorkerSelectedAt, 30)) {
        checks.push(fail(`service ${service.serviceId} selection stale`, "ADM Worker has not selected this service within 30 minutes.", service, "high"));
        fatal = true;
        continue;
      }
      if (service.manualActionRequired || ["nitrado_unauthorized", "nitrado_forbidden"].includes(classifiedError)) {
        checks.push(fail(`service ${service.serviceId} auth`, "ADM health shows an auth/file permission issue.", service, "high"));
        fatal = true;
        continue;
      }
      if (service.activeImportJob && isStuckImportJob(service.activeImportJob.updatedAt)) {
        checks.push(fail(`service ${service.serviceId} import job stuck`, "Automatic ADM import job has not updated within the threshold.", service.activeImportJob, "high"));
        fatal = true;
        continue;
      }
      const currentCursor = Math.max(
        Number(service.latestFileState?.cursorLine ?? 0),
        Number(service.latestFileState?.importedLineCount ?? 0),
        Number(service.latestFileState?.lineCount ?? 0),
      );
      const noftp = service.sourceMatrix?.find((source) => source.sourceName === "gameserver_details_log_files_noftp_download");
      const currentCaughtUp = currentCursor > 0 || /caught_up_waiting_for_growth|processed|completed_empty|completed_closed/i.test(String(service.latestFileState?.status ?? ""));
      if (noftp?.works && noftp.preferred && currentCaughtUp) {
        checks.push(pass(`service ${service.serviceId} current ADM`, "Nitrado Log Files source is preferred and current ADM has cursor/caught-up evidence.", {
          file: service.latestFileState?.fileName,
          status: service.latestFileState?.status,
          cursor: currentCursor,
        }));
        continue;
      }
      if (service.recoverable || classifyRecoverableProductionStatus(status) || classifyRecoverableProductionStatus(service.latestClassifiedError)) {
        const hasUpstreamReadBlock = classifiedError === "nitrado_upstream_down" || service.latestHttpStatus === 500 || service.latestHttpStatus === 503;
        const hasRetryEvidence = Boolean(service.nextRetryAt) || service.recoverable === true || /latest_adm_unreadable|nitrado_upstream_down|nitrado_rate_limited/.test(status);
        checks.push(pass(
          `service ${service.serviceId} recoverable`,
          hasUpstreamReadBlock && hasRetryEvidence
            ? "ADM Worker heartbeat fresh. Current ADM state is recoverable: NITRADO_UPSTREAM_DOWN. Retry/backoff is active."
            : "Service is in a recoverable automatic ADM state.",
          service,
        ));
      } else if (service.importJobStatus && /queued|processing|parsing|writing|rebuilding/i.test(service.importJobStatus)) {
        checks.push(pass(`service ${service.serviceId} import`, "Service has active automatic import work.", service));
      } else if (service.lastSuccessfulImportAt || service.lastProcessedFile) {
        checks.push(pass(`service ${service.serviceId} imported`, "Service has successful ADM import history.", service));
      } else {
        checks.push(skip(`service ${service.serviceId} waiting`, "No fatal ADM condition detected; waiting for first useful cycle.", service));
      }
    }

    if (Date.now() >= deadline || fatal) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (Date.now() < deadline);

  checks.push(lastSnapshot ? pass("adm health snapshot", "ADM health snapshot completed.", { services: lastSnapshot.services?.length ?? 0 }) : fail("adm health snapshot", "No ADM health snapshot was collected.", undefined, "high"));

  const report = makeReport("adm-cycle-watch", checks, [
    "Recoverable Nitrado states are acceptable when retry/backoff is present.",
    "Worker heartbeat staleness, auth errors, and stuck jobs require human review.",
  ]);
  writeReport("adm-cycle-watch", { ...report, snapshots });
  if (!report.ok) process.exit(1);
}

function isStuckImportJob(updatedAt: string | null | undefined) {
  const time = Date.parse(String(updatedAt ?? ""));
  return Number.isFinite(time) && Date.now() - time > 30 * 60 * 1000;
}

function heartbeatAgeSecondsFrom(value: string | null) {
  const time = Date.parse(String(value ?? ""));
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

function isOlderThanMinutes(value: string | null | undefined, minutes: number) {
  const time = Date.parse(String(value ?? ""));
  return !Number.isFinite(time) || Date.now() - time > minutes * 60 * 1000;
}

main().catch((error) => {
  const report = makeReport("adm-cycle-watch", [fail("adm cycle watch exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
  writeReport("adm-cycle-watch", report);
  process.exit(1);
});
