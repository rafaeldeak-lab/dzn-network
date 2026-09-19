import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = path.resolve("out");
const evidence = path.join(tmpdir(), "dzn-dashboard-details-20260912-qa");
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
    let details = false; let detailsAccountFree = false; let complimentaryAccess = true; let holdNextWars = false; let releaseWars;
    let holdNextBillingStatus = false; let releaseHeldBillingStatus; let holdNextHealth = false; let releaseHeldHealth;
    await page.route("**/*", async route => {
      const req = route.request(); const url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (req.method() !== "GET") { writes.push(url.pathname); return route.abort(); }
      reads.push(url.pathname);
      if (details && url.pathname === "/api/billing/status") {
        if (holdNextBillingStatus) {
          holdNextBillingStatus = false;
          await new Promise(resolve => { releaseHeldBillingStatus = resolve; });
        }
        return route.fulfill({ json: detailsAccountFree ? {
        plan_key: "free", plan_status: "free", current_period_start: null, current_period_end: null,
        current_period_end_label: "Not subscribed", cancel_at_period_end: false, linked_server_count: 1,
        can_link_more_servers: false, stripe_customer_exists: false, checkout_configured: { starter: true, pro: true },
        entitlements: { plan_key: "free", max_linked_servers: 1, included_bumps_per_month: 0 }
      } : {
        plan_key: "premium", plan_status: "active", current_period_start: "2026-06-18T12:00:00Z", current_period_end: "2026-07-18T12:00:00Z",
        current_period_end_label: "18 Jul 2026", cancel_at_period_end: false, linked_server_count: 1,
        can_link_more_servers: true, stripe_customer_exists: true, checkout_configured: { starter: true, pro: true },
        entitlements: { plan_key: "premium", max_linked_servers: 3, included_bumps_per_month: 2 }
        } });
      }
      if (details && url.pathname.endsWith("/advertising/bump")) return route.fulfill({ json: { ok: true, generated_at: new Date().toISOString(), advertising: {
        bump_count_current_period: 0, last_bumped_at: null, next_bump_at: null, bump_period_start: "2026-09-12", bump_period_end: "2026-10-12",
        bump_cooldown_days: complimentaryAccess ? 7 : 30, included_bumps_per_month: complimentaryAccess ? 2 : 0,
        access_source: complimentaryAccess ? "complimentary_showcase" : "billing",
        effective_listing_plan: complimentaryAccess ? "pro" : "free",
        listing_label: complimentaryAccess ? "Pro Listing" : "Free Listing"
      } } });
      if (details && url.pathname.endsWith("/dashboard/advanced-stats")) return route.fulfill({ json: {
        ok: true, available: true, stale: false, reason: null, generated_at: "2026-09-12T12:00:00Z",
        access: complimentaryAccess
          ? { source: "complimentary_showcase", effectivePlan: "pro", dashboardAnalytics: true, lockedModules: [] }
          : { source: "billing", effectivePlan: "free", dashboardAnalytics: false, lockedModules: [{ key: "server_top15", title: "Server Top 15 Showcase", requiredPlan: "pro", reason: "Pro unlocks advanced analytics." }] },
        summary: { kills: 10, deaths: 10, joins: 20, disconnects: 18, uniquePlayers: 2, eventsTracked: null,
          buildScore: 6, structuresBuilt: 2, raidScore: 1, totalDistanceM: 12500, onFootDistanceM: 9000,
          fastTravelEstimatedDistanceM: 3500, explorationPercent: 4.25, estimated: true, lastUpdatedAt: "2026-09-12T12:00:00Z" },
        boards: [{ metricKey: "server_top_kills", title: "Top 15 Kills", description: "Confirmed kills", category: "pvp", packageRequired: "pro",
          locked: !complimentaryAccess, rows: complimentaryAccess ? [{ rank: 1, playerName: "Example Player", displayValue: "10" }] : [] }],
        exploration: { supported: true, mapDisplayName: "Chernarus", exploredCellsCount: 10, totalExplorableCells: 100, explorationPercent: 4.25, activeExplorersCount: 2, topExplorerName: "Example Player", estimated: true }, notes: []
      } });
      if (details && url.pathname.endsWith("/wars")) {
        if (holdNextWars) {
          holdNextWars = false;
          await new Promise(resolve => { releaseWars = resolve; });
        }
        return route.fulfill({ json: { ok: true, available: true, server: { id: sample.id }, access: { effectivePlan: "premium", canCreateChallenge: false }, eligibility: { eligibleRulesets: [] }, events: [], pendingChallenges: [], trophies: [] } });
      }
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
        navigation: accountAvailable ? { plan_tier: accountPlan, plan_status: accountStatus, linked_server_count: 1, linked_server_limit: accountPlan === "pro" ? 3 : 1 } : null } });
      if (url.pathname.endsWith("/dashboard/health") && healthAvailable) {
        if (holdNextHealth) {
          holdNextHealth = false;
          await new Promise(resolve => { releaseHeldHealth = resolve; });
        }
        return route.fulfill({ json: {
        ok: true, generated_at: new Date().toISOString(), stale: false, source: "live", server_id: sample.id, server_name: sample.server_name,
        server_access: details && complimentaryAccess ? { source: "complimentary_showcase", effectiveListingPlan: "pro", expiresAt: null } : undefined,
        server: sample, current_plan: currentPlan, configured_plan: currentPlan, subscription_status: "active",
        plan_limits: { status_interval_minutes: 5, adm_discovery_interval_minutes: 5, adm_processing_interval_minutes: 5 },
        stats: { players: 2, kills: 10, deaths: 10, joins: 20, disconnects: 18, unique_players: 2, score: 123, rank: 1 },
        latest_events: [], recent_events_count: 0, latest_event_at: null, warnings: [],
        sync: { status: "active", active_job: null, last_processed_adm_filename: "sample.ADM", last_successful_sync: null, last_error: null,
          backfill_status: { missing_files_count: 0, queued_jobs_count: 0, completed_today: 0, unreadable_files_count: 0 }, latest_read_issue: null },
        cron: { metadata_recent: true, adm_recent: true, discord_recent: true, metadata: null, adm: null, discord: null },
        setup_progress: { percent: 100, checks: [] }
        } });
      }
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
    // /auth/me also returns free/free when its billing SELECT fails.
    await context.clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.getByText("Checking server plan...", { exact: true }).waitFor();
    assert.equal(await page.getByText(/^(Pro|Starter|Free) visual treatment$/).count(), 0);
    details = true; billingAvailable = true; healthAvailable = true; accountAvailable = true; accountPlan = "pro"; accountStatus = "active";
    holdNextBillingStatus = true;
    const advertisingWhileBillingHeld = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/advertising/bump") && response.status() === 200);
    await page.reload();
    const immediateBumps = page.getByText("Bumps This Period", { exact: true }).locator("..");
    await immediateBumps.scrollIntoViewIfNeeded();
    await advertisingWhileBillingHeld;
    await immediateBumps.getByText("0", { exact: true }).waitFor();
    assert.equal(typeof releaseHeldBillingStatus, "function");
    releaseHeldBillingStatus();
    await page.getByRole("button", { name: /Billing & Boosts/ }).click();
    await page.getByText("Billing Date", { exact: true }).waitFor();
    await page.getByText("Needs review (18 Jul 2026)", { exact: true }).waitFor();
    assert.equal(await page.getByText("Renews", { exact: true }).count(), 0);
    const promoMetric = page.getByText("Promo Credits", { exact: true }).locator("..");
    assert.match(await promoMetric.innerText(), /\b2\b/);
    assert.doesNotMatch(await promoMetric.innerText(), /\b8\b/);
    await promoMetric.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `period-and-credits-${width}.png`) });
    // Exact-server complimentary access must not unlock account-level Pro tools.
    detailsAccountFree = true; accountPlan = "free"; accountStatus = "free";
    await page.reload();
    await page.getByText("Start with Starter", { exact: true }).waitFor();
    assert.equal(await page.getByText("Pro locks", { exact: true }).count(), 2);
    // Remounting Overview must attach visibility observers to the new panels.
    await page.getByRole("button", { name: /^Overview/i }).click();
    const bumps = page.getByText("Bumps This Period", { exact: true }).locator("..");
    await bumps.scrollIntoViewIfNeeded();
    await bumps.getByText("0", { exact: true }).waitFor();
    assert.match(await bumps.innerText(), /\b0\b/);
    assert.doesNotMatch(await bumps.innerText(), /undefined|\//);
    await page.getByText("Pro Listing (complimentary)", { exact: true }).waitFor();
    await page.getByText("Exact-server DZN owner access. This does not create or represent a paid Stripe subscription.", { exact: true }).waitFor();
    assert.equal(await page.getByText(/undefined \/ undefined/).count(), 0);
    await page.screenshot({ path: path.join(evidence, `complimentary-plan-${width}.png`) });
    await page.getByText("Advanced Showcase Preview", { exact: true }).scrollIntoViewIfNeeded();
    await page.getByText("Pro (complimentary)", { exact: true }).last().waitFor();
    await page.getByText("Build Score", { exact: true }).waitFor();
    const advancedReadsBeforeRevocation = reads.filter((read) => read.endsWith("/dashboard/advanced-stats")).length;
    assert.ok(advancedReadsBeforeRevocation > 0);
    const advertisingReadsBeforeRevocation = reads.filter((read) => read.endsWith("/advertising/bump")).length;
    complimentaryAccess = false;
    const revocationHealth = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/dashboard/health") && response.status() === 200);
    await page.getByRole("button", { name: /^Sync Health/i }).click();
    await revocationHealth;
    await page.getByRole("button", { name: /^Overview/i }).click();
    const revokedAccess = page.getByText("Selected Server Access", { exact: true }).locator("../../..");
    await revokedAccess.scrollIntoViewIfNeeded();
    await revokedAccess.getByText("Free", { exact: true }).waitFor();
    await page.getByText("Bump Cooldown", { exact: true }).locator("..").getByText("30 days", { exact: true }).waitFor();
    assert.ok(reads.filter((read) => read.endsWith("/advertising/bump")).length > advertisingReadsBeforeRevocation);
    await page.getByText("Pro analytics required", { exact: true }).waitFor().catch(async error => {
      await writeFile(path.join(evidence, "revocation-failure.json"), JSON.stringify({
        errors,
        reads,
        body: await page.locator("body").innerText(),
      }, null, 2));
      throw error;
    });
    assert.ok(reads.filter((read) => read.endsWith("/dashboard/advanced-stats")).length > advancedReadsBeforeRevocation);
    assert.equal(await page.getByText("Pro (complimentary)", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Pro Listing (complimentary)", { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(evidence, `complimentary-revoked-${width}.png`) });
    complimentaryAccess = true;
    await page.reload();
    await page.getByText("Pro Listing (complimentary)", { exact: true }).waitFor();
    await page.getByText("Advanced Showcase Preview", { exact: true }).scrollIntoViewIfNeeded();
    await page.getByText("Pro (complimentary)", { exact: true }).last().waitFor();
    await page.getByText("Build Score", { exact: true }).waitFor();
    await page.getByText("Example Player", { exact: false }).waitFor();
    assert.equal(await page.getByText("Advanced showcase is not available yet. Core gameplay statistics remain available.", { exact: true }).count(), 0);
    assert.equal(await page.getByText(/Stats will appear after the next readable/).count(), 0);
    await page.screenshot({ path: path.join(evidence, `advanced-live-${width}.png`) });
    await page.getByRole("button", { name: /Billing & Boosts/ }).click();
    const advertisingListing = page.getByText("Listing Plan", { exact: true }).locator("..");
    await advertisingListing.getByText("Pro Listing (complimentary)", { exact: true }).waitFor();
    await page.getByText("This selected server has a 7-day complimentary DZN listing cooldown. It is not a paid Stripe subscription. Bumps are visibility only and do not change organic rank or score.", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, `complimentary-advertising-${width}.png`) });
    // A later health response must recover invalidated advertising data while Billing is active.
    holdNextHealth = true;
    releaseHeldHealth = undefined;
    const heldHealthRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith("/dashboard/health"));
    const advertisingBeforeHeldHealth = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/advertising/bump") && response.status() === 200);
    await page.reload();
    await heldHealthRequest;
    await page.getByRole("button", { name: /Billing & Boosts/ }).click();
    await advertisingBeforeHeldHealth;
    const listingBeforeHealth = page.getByText("Listing Plan", { exact: true }).locator("..");
    await listingBeforeHealth.getByText("Pro Listing (complimentary)", { exact: true }).waitFor();
    assert.equal(typeof releaseHeldHealth, "function");
    const recoveredAdvertising = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/advertising/bump") && response.status() === 200);
    releaseHeldHealth();
    await recoveredAdvertising;
    await listingBeforeHealth.getByText("Pro Listing (complimentary)", { exact: true }).waitFor();
    await page.getByText("Cooldown", { exact: true }).locator("..").getByText("7 days", { exact: true }).waitFor();
    holdNextWars = true;
    releaseWars = undefined;
    const pendingWarsRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith("/wars"));
    await page.reload();
    await page.getByText("Plan Access", { exact: true }).scrollIntoViewIfNeeded();
    await pendingWarsRequest;
    const accessMetric = page.getByText("Plan Access", { exact: true }).locator("..");
    assert.match(await accessMetric.innerText(), /Checking access/i);
    assert.doesNotMatch(await accessMetric.innerText(), /\bfree\b/i);
    assert.equal(typeof releaseWars, "function");
    const warsResponse = page.waitForResponse(response => response.url().endsWith("/wars"));
    releaseWars();
    await warsResponse;
    await accessMetric.getByText("Pro", { exact: true }).waitFor();
    assert.doesNotMatch(await accessMetric.innerText(), /premium|free/i);
    assert.equal(await page.getByText("Pro is required to create Server VS Server challenges.", { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(evidence, `wars-pro-${width}.png`) });
    details = false; billingAvailable = false; healthAvailable = false;
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
    results.push({ width, scenarios: ["pro-with-billing-unavailable", "billing-unknown-disabled", "production-free-status-checkout-enabled", "direct-overview-server-pro-account-free", "health-success-then-failure-drops-stale-plan", "auth-billing-lookup-failure-not-free", "unknown-account-status-not-free", "all-unavailable-not-a-downgrade", "historical-period-not-renewal", "legacy-pro-two-credits", "independent-advertising-while-billing-stalled", "complimentary-server-access-account-free-locks", "complimentary-advertising-label", "revoked-complimentary-access-drops-stale-health", "real-bump-response-no-undefined", "overview-remount-loads-unavailable-snapshot", "wars-loading-then-pro"], errors, writes });
    await context.close();
  }
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ syntheticOnly: true, results }, null, 2));
  console.log(`Dashboard plan QA passed. Evidence: ${evidence}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
