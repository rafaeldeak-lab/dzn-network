import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = path.resolve("out");
const evidence = path.join(tmpdir(), "dzn-dashboard-plan-display-qa");
await mkdir(evidence, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = path.resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
    if (!path.extname(file)) file += ".html";
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webm": "video/webm", ".png": "image/png", ".woff2": "font/woff2" })[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const sample = { id: "sample", server_name: "Example Showcase", display_name: "Example Showcase",
  status: "live", guild_id: "sample-guild", guild_name: "Example Community", game: "dayz", server_mode: "PVP",
  nitrado_service_id: "sample-service", adm_status: "connected", adm_latest_file: "sample.ADM", score: 123,
  original_owner_is_current_user: true, created_at: "2026-01-01", public_slug: "sample", map_name: "chernarusplus" };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const width of [1440, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce" });
    const page = await context.newPage(); const errors = []; const writes = []; const reads = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (/hydration|did not match/i.test(message.text())) errors.push(message.text()); });
    let currentPlan = "premium"; let healthAvailable = true;
    let accountPlan = "pro"; let accountStatus = "active"; let accountAvailable = true; let billingAvailable = false;
    await page.route("**/*", async route => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (req.method() !== "GET") { writes.push(url.pathname); return route.abort(); }
      reads.push(url.pathname);
      if (billingAvailable && url.pathname === "/api/billing/status") return route.fulfill({ json: {
        plan_key: "free", plan_status: "free", current_period_start: null, current_period_end: null,
        current_period_end_label: "Not subscribed", cancel_at_period_end: false, linked_server_count: 1,
        can_link_more_servers: false, stripe_customer_exists: false, checkout_configured: { starter: true, pro: true },
        entitlements: { plan_key: "free", max_linked_servers: 1, adm_discovery_interval_minutes: 0, adm_pull_interval_minutes: 0 }
      } });
      if (billingAvailable && url.pathname === "/api/billing/plans") return route.fulfill({ json: {
        plans: ["starter", "pro"].map(plan => ({ plan_key: plan, name: plan, price_label: plan === "starter" ? "GBP 2/month" : "GBP 10/month",
          configured: true, checkout_enabled: true, checkout_blocked_reason: null, features: [] }))
      } });
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { authenticated: true, user: { id: "owner", username: "Example Owner", discord_id: "123456789012345678" }, linkedServers: [sample], linkedServer: sample,
        navigation: accountAvailable ? { plan_tier: accountPlan, plan_status: accountStatus } : null } });
      if (url.pathname.endsWith("/dashboard/health") && healthAvailable) return route.fulfill({ json: {
        ok: true, generated_at: new Date().toISOString(), stale: false, source: "live", server_id: sample.id, server_name: sample.server_name,
        server: sample, current_plan: currentPlan, configured_plan: currentPlan, subscription_status: "active",
        plan_limits: { status_interval_minutes: 5, adm_discovery_interval_minutes: 5, adm_processing_interval_minutes: 5 },
        stats: { players: 2, kills: 10, deaths: 10, joins: 20, disconnects: 18, unique_players: 2, score: 123, rank: 1 },
        latest_events: [], recent_events_count: 0, latest_event_at: null, warnings: [],
        sync: { status: "active", active_job: null, last_processed_adm_filename: "sample.ADM", last_successful_sync: null, last_error: null,
          backfill_status: { missing_files_count: 0, queued_jobs_count: 0, completed_today: 0, unreadable_files_count: 0 }, latest_read_issue: null },
        cron: { metadata_recent: true, adm_recent: true, discord_recent: true, metadata: null, adm: null, discord: null },
        setup_progress: { percent: 100, checks: [] }
      } });
      if (url.pathname === "/api/dzn-pulse/config") return route.fulfill({ json: { ok: true, dznPulseEnabled: false, billingRemindersEnabled: false } });
      return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic unavailable response" } });
    });
    await page.goto(`${base}/dashboard`);
    await page.getByText("Pro visual treatment", { exact: true }).waitFor().catch(async error => {
      await writeFile(path.join(evidence, "failure.json"), JSON.stringify({ errors, body: await page.locator("body").innerText() }, null, 2));
      throw error;
    });
    assert.equal(await page.getByText("Starter visual treatment", { exact: true }).count(), 0);
    const proLabel = page.getByText("Pro visual treatment", { exact: true });
    await proLabel.scrollIntoViewIfNeeded();
    assert.ok(await proLabel.evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: path.join(evidence, `pro-${width}.png`) });
    await page.getByRole("button", { name: /Billing & Boosts/ }).click();
    await page.getByText("Checking billing...", { exact: true }).first().waitFor();
    const billingButtons = page.getByRole("button", { name: "Checking billing...", exact: true });
    assert.equal(await billingButtons.count(), 2);
    for (const button of await billingButtons.all()) assert.equal(await button.isEnabled(), false);
    assert.equal(await page.getByText("Free Listing", { exact: true }).count(), 0);
    await billingButtons.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `billing-pending-${width}.png`) });
    currentPlan = "free";
    accountPlan = "free";
    accountStatus = "free";
    billingAvailable = true;
    await page.reload();
    await page.getByText("Free visual treatment", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Billing & Boosts/ }).click();
    await page.getByRole("button", { name: "Choose Starter", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Choose Starter", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Upgrade", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Checking billing...", exact: true }).count(), 0);
    // Direct Overview must fetch server access even with actual Free account billing.
    currentPlan = "premium";
    const healthSuccess = page.waitForResponse(res => new URL(res.url()).pathname.endsWith("/dashboard/health") && res.status() === 200).catch(async error => {
      await writeFile(path.join(evidence, "health-failure.json"), JSON.stringify({ errors, reads, body: await page.locator("body").innerText() }, null, 2));
      return error;
    });
    await page.reload();
    assert.ok(!(await healthSuccess instanceof Error));
    await page.getByText("Pro visual treatment", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Billing & Boosts/ }).click();
    assert.equal(await page.getByRole("button", { name: "Choose Starter", exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "Upgrade", exact: true }).isEnabled(), true);
    billingAvailable = false;
    healthAvailable = false;
    const healthFailure = page.waitForResponse(res => new URL(res.url()).pathname.endsWith("/dashboard/health") && res.status() === 503).catch(error => error);
    await page.getByRole("button", { name: /^Sync Health/i }).click();
    assert.ok(!(await healthFailure instanceof Error));
    await page.getByRole("button", { name: /^Overview/i }).click();
    await page.getByText("Free visual treatment", { exact: true }).waitFor();
    accountPlan = "pro";
    accountStatus = "unknown";
    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.getByText("Checking server plan...", { exact: true }).waitFor();
    assert.equal(await page.getByText(/^(Pro|Starter|Free) visual treatment$/).count(), 0);
    accountAvailable = false;
    await page.reload();
    await page.getByText("Checking server plan...", { exact: true }).waitFor();
    assert.equal(await page.getByText(/^(Pro|Starter|Free) visual treatment$/).count(), 0);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    results.push({ width, scenarios: ["pro-with-billing-unavailable", "billing-unknown-disabled", "production-free-status-checkout-enabled", "direct-overview-server-pro-account-free", "health-success-then-failure-drops-stale-plan", "unknown-account-status-not-free", "all-unavailable-not-a-downgrade"], errors, writes });
    await context.close();
  }
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ syntheticOnly: true, results }, null, 2));
  console.log(`Dashboard plan QA passed. Evidence: ${evidence}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
