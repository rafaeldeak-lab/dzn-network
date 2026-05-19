import { execSync } from "node:child_process";

type CheckStatus = "pass" | "warn" | "fail";
type CronRow = {
  source: string | null;
  job_type: string | null;
  status: string | null;
  created_at: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  processed_count?: number | null;
  skipped_count?: number | null;
  failed_count?: number | null;
};

const appUrl = normalizeAppUrl(process.env.DZN_APP_URL) ?? "https://dzn-network.pages.dev";
const cronSecret = process.env.DZN_CRON_SECRET?.trim() ?? "";
const checks: Array<{ status: CheckStatus; title: string; detail: string }> = [];

function add(status: CheckStatus, title: string, detail: string) {
  checks.push({ status, title, detail });
}

function pass(title: string, detail: string) {
  add("pass", title, detail);
}

function warn(title: string, detail: string) {
  add("warn", title, detail);
}

function fail(title: string, detail: string) {
  add("fail", title, detail);
}

function runWranglerQuery<T>(sql: string): T[] {
  const compactSql = sql.replace(/\s+/g, " ").trim();
  const output = execSync(`npx wrangler d1 execute dzn_network_db --remote --json --command "${compactSql.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output) as Array<{ results?: T[]; success?: boolean }>;
  return parsed.flatMap((item) => item.results ?? []);
}

async function fetchEndpoint(path: string, init: RequestInit) {
  try {
    const response = await fetch(new URL(path, appUrl), {
      redirect: "manual",
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text().catch(() => "");
    return { response, text };
  } catch (error) {
    return { response: null, text: error instanceof Error ? error.message : "request failed" };
  }
}

function normalizeAppUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

function ageMinutes(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.now() - Date.parse(value);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60000)) : null;
}

function formatRow(row: CronRow | null | undefined) {
  if (!row) return "none";
  const age = ageMinutes(row.created_at);
  const metrics = [
    row.processed_count !== undefined && row.processed_count !== null ? `processed=${row.processed_count}` : null,
    row.skipped_count !== undefined && row.skipped_count !== null ? `skipped=${row.skipped_count}` : null,
    row.failed_count !== undefined && row.failed_count !== null ? `failed=${row.failed_count}` : null,
  ].filter(Boolean).join(", ");
  return `${row.source ?? "unknown"} ${row.job_type ?? "unknown"} ${row.status ?? "unknown"} at ${row.created_at ?? "unknown"} (${age ?? "?"}m ago${metrics ? `, ${metrics}` : ""})`;
}

async function checkCronEndpoint(path: string) {
  const missing = await fetchEndpoint(path, {
    method: "POST",
    body: JSON.stringify({ source: "manual", cron: "cron-production-check" }),
  });
  if (missing.response?.status === 401) pass(`${path} missing secret`, "Rejected with HTTP 401.");
  else fail(`${path} missing secret`, missing.response ? `Expected 401, got HTTP ${missing.response.status}.` : missing.text);

  if (!cronSecret) {
    warn(`${path} valid secret`, "Skipped because DZN_CRON_SECRET is not set in this shell.");
    return;
  }

  const valid = await fetchEndpoint(path, {
    method: "POST",
    headers: { "x-dzn-cron-secret": cronSecret },
    body: JSON.stringify({
      source: "manual",
      cron: "cron-production-check",
      max_servers: 1,
      max_jobs: 1,
      max_lines_per_server: 1000,
    }),
  });
  if (valid.response?.ok) pass(`${path} valid secret`, `Accepted with HTTP ${valid.response.status}.`);
  else fail(`${path} valid secret`, valid.response ? `HTTP ${valid.response.status}: ${valid.text.slice(0, 180)}` : valid.text);
}

async function main() {
  let rows: CronRow[] = [];
  try {
    rows = runWranglerQuery<CronRow>(
      `SELECT source, job_type, status, created_at, error_message, duration_ms, processed_count, skipped_count, failed_count
       FROM automation_cron_runs
       ORDER BY created_at DESC
       LIMIT 30`,
    );
    pass("D1 automation_cron_runs query", `Read ${rows.length} recent rows.`);
  } catch (error) {
    warn("D1 automation_cron_runs metrics columns", "Cron metric columns are not readable yet. Run npm run db:migrate:remote after deploying this change.");
    try {
      rows = runWranglerQuery<CronRow>(
        `SELECT source, job_type, status, created_at, error_message
         FROM automation_cron_runs
         ORDER BY created_at DESC
         LIMIT 30`,
      );
      pass("D1 automation_cron_runs legacy query", `Read ${rows.length} recent rows.`);
    } catch (legacyError) {
      fail("D1 automation_cron_runs query", legacyError instanceof Error ? legacyError.message : error instanceof Error ? error.message : "query failed");
    }
  }

  const latestCloudflare = rows.find((row) => row.source === "cloudflare") ?? null;
  const latestGithub = rows.find((row) => row.source === "github-backup") ?? null;
  const latestMetadata = rows.find((row) => row.job_type === "metadata") ?? null;
  const latestAdm = rows.find((row) => row.job_type === "adm") ?? null;
  const latestDiscord = rows.find((row) => row.job_type === "discord-posts") ?? null;
  const latestCloudflareMetadata = rows.find((row) => row.source === "cloudflare" && row.job_type === "metadata") ?? null;
  const latestCloudflareAdm = rows.find((row) => row.source === "cloudflare" && row.job_type === "adm") ?? null;
  const latestCloudflareDiscord = rows.find((row) => row.source === "cloudflare" && row.job_type === "discord-posts") ?? null;

  const cloudflareAge = ageMinutes(latestCloudflare?.created_at);
  if (cloudflareAge !== null && cloudflareAge <= 5) pass("Cloudflare cron check-in", formatRow(latestCloudflare));
  else fail("Cloudflare cron check-in", `No cloudflare row in the last 5 minutes. Latest: ${formatRow(latestCloudflare)}`);

  const githubAge = ageMinutes(latestGithub?.created_at);
  if (githubAge !== null && githubAge <= 15) pass("GitHub backup cron check-in", formatRow(latestGithub));
  else warn("GitHub backup cron check-in", `No github-backup row in the last 15 minutes. Latest: ${formatRow(latestGithub)}`);

  for (const [label, row] of [
    ["metadata", latestMetadata],
    ["adm", latestAdm],
    ["discord-posts", latestDiscord],
  ] as const) {
    if (row) pass(`Latest ${label} cron row`, formatRow(row));
    else fail(`Latest ${label} cron row`, "No row found.");
  }

  for (const [label, row] of [
    ["metadata", latestCloudflareMetadata],
    ["adm", latestCloudflareAdm],
    ["discord-posts", latestCloudflareDiscord],
  ] as const) {
    const rowAge = ageMinutes(row?.created_at);
    if (rowAge !== null && rowAge <= 5) pass(`Cloudflare ${label} cron row`, formatRow(row));
    else fail(`Cloudflare ${label} cron row`, `No cloudflare ${label} row in the last 5 minutes. Latest: ${formatRow(row)}`);
  }

  for (const endpoint of ["/api/sync/metadata/run", "/api/sync/adm/run", "/api/sync/discord-posts/run"]) {
    await checkCronEndpoint(endpoint);
  }

  printReport(rows);
}

function printReport(rows: CronRow[]) {
  const icons: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  console.log("\nDZN Production Cron Check");
  console.log("=========================");
  console.log(`Target: ${appUrl}`);
  console.log("\nRecent rows:");
  for (const row of rows.slice(0, 10)) console.log(`- ${formatRow(row)}${row.error_message ? ` error=${row.error_message}` : ""}`);
  console.log("\nChecks:");
  for (const check of checks) console.log(`${icons[check.status]} ${check.title}: ${check.detail}`);
  const failed = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  console.log(`\nSummary: ${checks.length} checks, ${failed} failed, ${warnings} warnings.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("Cron production check crashed", error instanceof Error ? error.message : "unknown error");
  printReport([]);
  process.exitCode = 1;
});
