export {};

type CheckStatus = "pass" | "warn" | "fail";

type LiveCheck = {
  status: CheckStatus;
  title: string;
  detail: string;
};

const checks: LiveCheck[] = [];
const appUrl = normalizeAppUrl(process.env.DZN_APP_URL) ?? "https://dzn-network.pages.dev";
const cronSecret = process.env.DZN_CRON_SECRET?.trim() ?? "";

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

function normalizeAppUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    warn("DZN_APP_URL", "Invalid DZN_APP_URL in local env; falling back to https://dzn-network.pages.dev.");
    return null;
  }
}

function url(path: string) {
  return new URL(path, appUrl).toString();
}

async function fetchStatus(path: string, init: RequestInit = {}) {
  let lastError = "request failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url(path), {
        redirect: "manual",
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text().catch(() => "");
      if (!isTransientStatus(response.status) || attempt === 3) {
        return { ok: true, response, text };
      }
      lastError = `HTTP ${response.status}: ${safeSnippet(text)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
      if (attempt === 3) {
        return {
          ok: false,
          response: null,
          text: lastError,
        };
      }
    }
    await sleep(1000 * attempt);
  }
  return {
    ok: false,
    response: null,
    text: lastError,
  };
}

function isTransientStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPage(path: string, label: string) {
  const result = await fetchStatus(path, { method: "GET" });
  if (!result.ok || !result.response) {
    fail(label, result.text);
    return;
  }
  if ((result.response.status >= 200 && result.response.status < 400) || result.response.status === 401 || result.response.status === 403) {
    pass(label, `HTTP ${result.response.status}`);
  } else {
    fail(label, `Unexpected HTTP ${result.response.status}`);
  }
}

async function checkHomeStats() {
  const result = await fetchStatus("/api/public/home-stats", { method: "GET" });
  if (!result.ok || !result.response) {
    fail("Public home-stats", result.text);
    return;
  }
  if (!result.response.ok) {
    fail("Public home-stats", `HTTP ${result.response.status}`);
    return;
  }
  const json = safeJson(result.text);
  const hasLoggedIn = json && typeof json === "object" && "loggedIn" in json;
  const hasPreviewMode = json && typeof json === "object" && "previewMode" in json;
  const vary = result.response.headers.get("vary") ?? "";
  const cacheControl = result.response.headers.get("cache-control") ?? "";
  if (hasLoggedIn && hasPreviewMode) pass("Public home-stats JSON", "Response includes loggedIn and previewMode.");
  else fail("Public home-stats JSON", "Response is missing loggedIn or previewMode.");
  if (vary.toLowerCase().includes("cookie")) pass("Public home-stats Vary", "Vary includes Cookie.");
  else warn("Public home-stats Vary", `Vary header was "${vary || "missing"}".`);
  if (cacheControl.toLowerCase().includes("no-store")) {
    pass("Public home-stats cache", "Authenticated/private response uses no-store.");
  } else if (cacheControl) {
    pass("Public home-stats cache", `Logged-out public response uses cache policy "${cacheControl}".`);
  } else {
    warn("Public home-stats cache", "Cache-Control header is missing.");
  }
}

async function checkProtectedCronEndpoint(path: string) {
  const missing = await fetchStatus(path, {
    method: "POST",
    body: JSON.stringify({ source: "manual", cron: "automation-live-check" }),
  });
  if (missing.response?.status === 401) pass(`${path} rejects missing secret`, "HTTP 401");
  else fail(`${path} rejects missing secret`, missing.response ? `Expected 401, got ${missing.response.status}` : missing.text);

  if (!cronSecret) {
    warn(`${path} valid secret check`, "Skipped because DZN_CRON_SECRET is not set in this local shell.");
    return;
  }

  const valid = await fetchStatus(path, {
    method: "POST",
    headers: { "x-dzn-cron-secret": cronSecret },
    body: JSON.stringify({
      source: "manual",
      cron: "automation-live-check",
      max_servers: 3,
      max_jobs: 3,
      max_lines_per_server: 5000,
    }),
  });
  if (valid.response?.ok) {
    pass(`${path} accepts correct secret`, `HTTP ${valid.response.status}`);
  } else {
    fail(`${path} accepts correct secret`, valid.response ? `HTTP ${valid.response.status}: ${safeSnippet(valid.text)}` : valid.text);
  }
}

async function checkAutomationHealth() {
  const result = await fetchStatus("/api/automation/health", { method: "GET" });
  if (result.response?.status === 401 || result.response?.status === 403) {
    pass("Automation health auth", `Owner/Admin auth required: HTTP ${result.response.status}`);
  } else if (result.response?.ok) {
    warn("Automation health auth", "Endpoint returned 200 without browser auth. Confirm this is expected in the current environment.");
  } else {
    fail("Automation health auth", result.response ? `Unexpected HTTP ${result.response.status}` : result.text);
  }
}

async function checkOptionalWorkerHealth() {
  const workerUrl = process.env.DZN_SYNC_WORKER_URL?.trim();
  if (!workerUrl) {
    warn("Worker health URL", "DZN_SYNC_WORKER_URL is not set; skipping optional worker health check.");
    return;
  }
  const result = await fetchStatus(workerUrl, { method: "GET" });
  if (result.response?.ok) pass("Worker health URL", `HTTP ${result.response.status}`);
  else warn("Worker health URL", result.response ? `HTTP ${result.response.status}` : result.text);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeSnippet(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 220);
}

function printReport() {
  const icons: Record<CheckStatus, string> = {
    pass: "✅ PASS",
    warn: "⚠️ WARN",
    fail: "❌ FAIL",
  };
  console.log("\nDZN Automation Live Check");
  console.log("=========================");
  console.log(`Target: ${appUrl}`);
  for (const check of checks) {
    console.log(`${icons[check.status]} ${check.title}`);
    console.log(`   ${check.detail}`);
  }
  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  console.log("\nSummary");
  console.log("-------");
  console.log(`Total checks: ${checks.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Warnings: ${warnings}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

async function main() {
  await checkPage("/", "Production homepage");
  await checkPage("/dashboard", "Production dashboard");
  await checkHomeStats();
  for (const endpoint of ["/api/sync/metadata/run", "/api/sync/adm/run", "/api/sync/discord-posts/run"]) {
    await checkProtectedCronEndpoint(endpoint);
  }
  await checkAutomationHealth();
  await checkOptionalWorkerHealth();
  printReport();
}

main().catch((error) => {
  fail("Automation live check crashed", error instanceof Error ? error.message : "Unknown error");
  printReport();
  process.exitCode = 1;
});
