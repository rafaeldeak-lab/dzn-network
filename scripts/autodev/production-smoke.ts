import { fail, loadConfig, makeReport, pass, skip, writeReport, type AutoDevCheck } from "./lib";

const config = loadConfig();
const baseUrl = (process.env.DZN_APP_URL || config.productionUrl).replace(/\/$/, "");
const cronSecret = process.env.DZN_CRON_SECRET || process.env.SYNC_CRON_SECRET || "";

async function request(path: string, init?: RequestInit) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      redirect: "manual",
      ...init,
      headers: {
        "user-agent": "dzn-autodev-production-smoke",
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.text().catch(() => "");
    return { ok: true, status: response.status, durationMs: Date.now() - startedAt, body: body.slice(0, 2000), fullBody: body };
  } catch (error) {
    const body = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, durationMs: Date.now() - startedAt, body, fullBody: body };
  }
}

async function main() {
  const checks: AutoDevCheck[] = [];
  const routeScope: Record<string, "adm" | "sanity-out-of-scope"> = {
    "/": "adm",
    "/dashboard": "adm",
    "/events": "sanity-out-of-scope",
  };
  for (const path of Object.keys(routeScope)) {
    const result = await request(path);
    checks.push(result.ok && result.status === 200
      ? pass(`GET ${path}`, routeScope[path] === "adm" ? "ADM-facing route returned 200." : "Route sanity check returned 200; failures are out-of-scope unless caused by ADM shared code.", result)
      : fail(`GET ${path}`, routeScope[path] === "adm" ? `Expected 200, got ${result.status}.` : `Route sanity check failed with ${result.status}; mark out-of-scope unless tied to ADM code.`, result, routeScope[path] === "adm" ? "high" : "medium"));
  }

  const home = await request("/");
  checks.push(!/Network stats could not be loaded right now/i.test(home.body)
    ? pass("homepage first-sync copy", "Homepage does not show the scary generic network failure copy in the initial HTML.", { status: home.status })
    : fail("homepage first-sync copy", "Homepage shows scary generic network failure copy while ADM may simply be awaiting first sync.", { status: home.status }, "medium"));

  const homeStats = await request("/api/public/home-stats");
  const homeStatsJson = parseJson(homeStats.fullBody);
  const homeStatsHasAdmEvidence = hasAdmHomeStatsEvidence(homeStatsJson);
  checks.push(homeStats.ok && homeStats.status === 200 && homeStatsJson?.ok && homeStatsJson.source !== "empty_no_cache" && homeStatsHasAdmEvidence
    ? pass("public home-stats ADM snapshot", "Public home-stats returns last-known ADM data or a valid snapshot.", {
      status: homeStats.status,
      source: homeStatsJson?.source,
      totals: homeStatsJson?.totals,
    })
    : fail("public home-stats ADM snapshot", `Expected public home-stats 200 JSON with non-empty source, got HTTP ${homeStats.status}.`, homeStats, "medium"));

  for (const path of ["/api/debug/nitrado-file-read", "/api/sync/adm/retry-unreadable", "/api/sync/adm/run", "/api/autodev/adm-health"]) {
    const result = await request(path, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    checks.push(result.ok && result.status === 401
      ? pass(`POST ${path} unauthenticated`, "Protected endpoint returned 401.", { status: result.status })
      : fail(`POST ${path} unauthenticated`, `Protected endpoint must return 401, got ${result.status}.`, result, "high"));
  }

  if (cronSecret) {
    const result = await request("/api/autodev/adm-health", {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${cronSecret}`,
        "x-dzn-cron-secret": cronSecret,
        "x-sync-cron-secret": cronSecret,
        "x-cron-secret": cronSecret,
      },
    });
    const json = parseJson(result.body);
    if (!result.ok || result.status >= 500) {
      checks.push(fail("ADM health authenticated", `ADM health endpoint failed with ${result.status}.`, result, "high"));
    } else if (result.status === 401 || result.status === 403) {
      checks.push(fail("ADM health authenticated", `ADM health auth failed with ${result.status}.`, { status: result.status }, "high"));
    } else if (result.status !== 200 || !json?.ok) {
      checks.push(fail("ADM health authenticated", `Expected ADM health 200 JSON, got ${result.status}.`, result, "high"));
    } else if (json.worker?.heartbeatState === "stale" || Number(json.worker?.heartbeatAgeSeconds ?? 0) > 15 * 60) {
      checks.push(fail("ADM Worker heartbeat", "ADM Worker heartbeat is stale beyond threshold.", json.worker, "high"));
    } else if (json.worker?.heartbeatState === "missing") {
      checks.push(fail("ADM Worker heartbeat", "ADM Worker heartbeat is missing.", json.worker, "high"));
    } else {
      checks.push(pass("ADM health authenticated", "ADM health returned protected JSON; recoverable Nitrado states do not fail production smoke.", {
        status: json.status,
        worker: json.worker,
        summary: json.summary,
      }));
    }
  } else {
    checks.push(skip("ADM health authenticated", "Cron secret not present; authenticated ADM health is covered by post-deploy ADM cycle watch."));
  }

  const report = makeReport("production-smoke", checks, [
    "AutoDev production smoke is ADM-scoped; non-ADM route failures are reported but not auto-fixed.",
    "If a protected ADM endpoint returns 200 unauthenticated, stop and fix auth immediately.",
  ]);
  writeReport("production-smoke", report);
  if (!report.ok) process.exit(1);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hasAdmHomeStatsEvidence(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as { totals?: Record<string, unknown>; topServers?: unknown[] };
  const totals = record.totals ?? {};
  return Number(totals.statsActiveServers ?? 0) > 0
    || Number(totals.killsTracked ?? 0) > 0
    || Number(totals.deathsTracked ?? 0) > 0
    || Number(totals.joinsTracked ?? 0) > 0
    || Number(totals.recentEventsCount ?? 0) > 0
    || (Array.isArray(record.topServers) && record.topServers.length > 0);
}

main().catch((error) => {
  const report = makeReport("production-smoke", [fail("production smoke exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
  writeReport("production-smoke", report);
  process.exit(1);
});
