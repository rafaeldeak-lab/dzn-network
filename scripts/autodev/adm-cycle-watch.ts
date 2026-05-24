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
  activeImportJob?: { updatedAt?: string | null; status?: string | null } | null;
};

type AdmHealthSnapshot = {
  ok?: boolean;
  status?: string;
  summary?: { workerHeartbeatFresh?: boolean; fatalIssues?: number; recoverableIssues?: number };
  worker?: { heartbeat?: { created_at?: string | null } | null };
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
    const heartbeatAt = Date.parse(result.json.worker?.heartbeat?.created_at ?? "");
    if (!Number.isFinite(heartbeatAt)) {
      checks.push(warn("worker heartbeat", "No ADM Worker heartbeat found yet.", result.json.worker, "medium"));
    } else if (Date.now() - heartbeatAt > 20 * 60 * 1000) {
      checks.push(fail("worker heartbeat stale", "ADM Worker heartbeat is stale beyond threshold.", result.json.worker, "high"));
      fatal = true;
      break;
    } else {
      checks.push(pass("worker heartbeat", "ADM Worker heartbeat is fresh.", result.json.worker));
    }

    for (const service of result.json.services ?? []) {
      const status = String(service.lastSyncStatus ?? service.latestClassifiedError ?? "").toLowerCase();
      const classifiedError = String(service.latestClassifiedError ?? "").toLowerCase();
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
      if (service.recoverable || classifyRecoverableProductionStatus(status) || classifyRecoverableProductionStatus(service.latestClassifiedError)) {
        const hasUpstreamReadBlock = classifiedError === "nitrado_upstream_down" || service.latestHttpStatus === 500 || service.latestHttpStatus === 503;
        const hasRetryEvidence = Boolean(service.nextRetryAt) || service.recoverable === true || /latest_adm_unreadable|nitrado_upstream_down|nitrado_rate_limited/.test(status);
        checks.push(pass(
          `service ${service.serviceId} recoverable`,
          hasUpstreamReadBlock && hasRetryEvidence
            ? "Recoverable: Nitrado upstream ADM read blocked; auto retry scheduled or tracked."
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

main().catch((error) => {
  const report = makeReport("adm-cycle-watch", [fail("adm cycle watch exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
  writeReport("adm-cycle-watch", report);
  process.exit(1);
});
