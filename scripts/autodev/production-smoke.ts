import { fail, loadConfig, makeReport, pass, writeReport, type AutoDevCheck } from "./lib";

const config = loadConfig();
const baseUrl = (process.env.DZN_APP_URL || config.productionUrl).replace(/\/$/, "");

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
    return { ok: true, status: response.status, durationMs: Date.now() - startedAt, body: await response.text().catch(() => "") };
  } catch (error) {
    return { ok: false, status: 0, durationMs: Date.now() - startedAt, body: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const checks: AutoDevCheck[] = [];
  for (const path of ["/", "/dashboard", "/events", "/events/tournaments", "/events/challenges", "/events/create"]) {
    const result = await request(path);
    checks.push(result.ok && result.status === 200
      ? pass(`GET ${path}`, "Route returned 200.", result)
      : fail(`GET ${path}`, `Expected 200, got ${result.status}.`, result, "high"));
  }

  for (const path of ["/api/debug/nitrado-file-read", "/api/sync/adm/retry-unreadable", "/api/sync/adm/run"]) {
    const result = await request(path, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    checks.push(result.ok && result.status === 401
      ? pass(`POST ${path} unauthenticated`, "Protected endpoint returned 401.", { status: result.status })
      : fail(`POST ${path} unauthenticated`, `Protected endpoint must return 401, got ${result.status}.`, result, "high"));
  }

  const report = makeReport("production-smoke", checks, [
    "If a public route fails, inspect Cloudflare Pages deployment.",
    "If a protected endpoint returns 200 unauthenticated, stop and fix auth immediately.",
  ]);
  writeReport("production-smoke", report);
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  const report = makeReport("production-smoke", [fail("production smoke exception", error instanceof Error ? error.message : String(error), undefined, "high")]);
  writeReport("production-smoke", report);
  process.exit(1);
});
