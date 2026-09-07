import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const root = path.resolve("out");
const evidence = process.env.DZN_PAYMENT_QA_OUTPUT ?? path.join(tmpdir(), "dzn-payment-copy-qa");
await mkdir(evidence, { recursive: true });
const markup = await readFile(path.join(root, "pricing.html"), "utf8");
assert.match(markup, /Eligible accounts/);
assert.match(markup, /Payment and trial questions/);
assert.match(markup, /name="description"/);
assert.ok(!markup.includes("Opening Starter vs Pro"));
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "GET") { res.writeHead(503); res.end('{"error":"Local preview only. Payments are disabled."}'); return; }
      if (url.pathname === "/api/auth/me") { res.writeHead(401); res.end('{"authenticated":false}'); }
      else if (url.pathname === "/api/billing/plans") res.end('{"plans":[{"plan_key":"starter","configured":false,"checkout_enabled":false},{"plan_key":"pro","configured":false,"checkout_enabled":false}]}');
      else res.end('{"ok":true,"dznPulseEnabled":false,"billingRemindersEnabled":false}');
      return;
    }
    if (url.pathname === "/qa-stripe") { res.end("Synthetic Stripe destination. No payment provider connected."); return; }
    const pathname = url.pathname === "/" ? "/index.html" : path.extname(url.pathname) ? url.pathname : url.pathname + ".html";
    const file = path.resolve(root, "." + pathname);
    if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
    const type = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".webp":"image/webp", ".webm":"video/webm", ".woff2":"font/woff2" }[path.extname(file)] ?? "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(process.argv.includes("--serve") ? Number(process.env.PORT ?? 3091) : 0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log("Local exported-site preview, no payments: " + base + "/pricing");
if (!process.argv.includes("--serve")) {
  const { chromium } = await import(process.env.DZN_QA_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DZN_QA_PLAYWRIGHT_PATH).href : "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  try {
    for (const width of [1440, 900, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: width <= 390 ? "reduce" : "no-preference" });
      const page = await context.newPage();
      const errors = [], writes = [], external = [];
      let availability = "paused", authenticated = false, authFailure = 0;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== base) { external.push(url.origin); await route.abort(); return; }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        if (url.pathname === "/api/billing/plans") {
          if (availability === "error") return route.fulfill({ status: 503, json: { error: "Unavailable" } });
          return route.fulfill({ json: { plans: ["starter","pro"].map(plan_key => ({ plan_key, configured: true, ...(availability === "unknown" ? {} : { checkout_enabled: availability === "ready" }) })) } });
        }
        if (url.pathname === "/api/auth/me") return route.fulfill({ status: authFailure || (authenticated ? 200 : 401), json: { authenticated, ...(authenticated ? { user: { id: "qa-user", discord_id: "qa-discord", username: "QA Player", avatar: null } } : {}) } });
        if (req.method() !== "GET") {
          assert.equal(url.pathname, "/api/billing/create-checkout-session");
          const body = req.postDataJSON(); writes.push(body);
          assert.deepEqual(Object.keys(body).sort(), body.accepted_offer ? ["accepted_offer","plan_key","returnTo"] : ["plan_key","returnTo"]);
          if (body.plan_key === "starter" && !body.accepted_offer) return route.fulfill({ status: 409, json: { error: "Confirmation required", errorCode: "STARTER_PAID_CONFIRMATION_REQUIRED", offer: { id: "starter-gbp-2-month-no-trial-v1", confirmation: "a".repeat(64) } } });
          return route.fulfill({ json: { url: base + "/qa-stripe" } });
        }
        return route.fulfill({ json: { ok: true, dznPulseEnabled: false, billingRemindersEnabled: false, items: [], unreadCount: 0 } });
      });
      await page.goto(base + "/pricing?intent=owner_setup&returnTo=%2Fsetup");
      await page.getByText(/Checkout is currently unavailable/).first().waitFor();
      assert.equal(await page.getByRole("button", { name: "Choose Starter", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Choose Pro", exact: true }).isDisabled(), true);
      assert.equal(writes.length, 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal overflow");
      assert.match(await page.locator('meta[name="description"]').getAttribute("content"), /Eligible accounts.*£2\/month.*£10\/month.*monthly renewal/);
      assert.match(await page.locator('link[rel="canonical"]').getAttribute("href"), /\/pricing$/);
      for (const details of await page.locator("details").all()) {
        await details.locator("summary").focus(); await page.keyboard.press("Enter");
        assert.equal(await details.getAttribute("open"), "");
      }
      assert.equal(await page.locator("tbody .text-green-400").count() > 0, true);
      assert.equal(await page.locator("tbody .text-red-400").count() > 0, true);
      await page.screenshot({ path: path.join(evidence, `pricing-paused-${width}.png`), fullPage: true });
      availability = "unknown"; await page.reload();
      await page.getByText(/Checkout is currently unavailable/).first().waitFor();
      assert.equal(await page.getByRole("button", { name: "Choose Starter", exact: true }).isDisabled(), true);
      availability = "error"; await page.reload();
      await page.getByText(/could not check checkout availability/).first().waitFor();
      availability = "ready"; await page.getByRole("button", { name: "Check again" }).first().click();
      await page.getByRole("link", { name: "Sign in to choose Starter" }).waitFor();
      const login = new URL(await page.getByRole("link", { name: "Sign in to choose Starter" }).getAttribute("href"), base);
      assert.equal(login.searchParams.get("returnTo"), "/pricing?returnTo=%2Fsetup");
      assert.equal(writes.length, 0, "Reads, retries and login entry do not create checkout");
      for (const status of [403, 500, 503]) {
        authFailure = status; await page.reload();
        await page.getByText(/could not check checkout availability/).first().waitFor();
        assert.equal(await page.getByRole("button", { name: "Choose Starter", exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole("button", { name: "Choose Pro", exact: true }).isDisabled(), true);
        assert.equal(writes.length, 0, "Auth service failures must not start checkout");
      }
      authFailure = 0;
      authenticated = true; await page.reload();
      await page.getByRole("button", { name: "Choose Starter", exact: true }).waitFor();
      await page.getByRole("button", { name: "Choose Starter", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /£2.*due.*£2\/month/s);
      assert.equal(await dialog.getByRole("button", { name: "Continue to Stripe" }).isDisabled(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name: "Choose Starter", exact: true }).evaluate(el => el === document.activeElement), true);
      await page.getByRole("button", { name: "Choose Starter", exact: true }).click();
      await dialog.getByRole("checkbox").check();
      await page.screenshot({ path: path.join(evidence, `returning-starter-${width}.png`), fullPage: true });
      await dialog.getByRole("button", { name: "Continue to Stripe" }).click();
      await page.waitForURL(base + "/qa-stripe");
      assert.equal(writes.at(-1).accepted_offer, "a".repeat(64));
      assert.equal(writes.at(-1).returnTo, "/setup");
      await page.goto(base + "/pricing?returnTo=https%3A%2F%2Fevil.example");
      await page.getByRole("button", { name: "Choose Pro", exact: true }).click();
      await page.waitForURL(base + "/qa-stripe");
      assert.deepEqual(writes.at(-1), { plan_key: "pro", returnTo: "/setup" });
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      results.push({ width, status: "passed", states: ["paused","unknown","unavailable","retry","anonymous","returning-confirmation","safe-return-path"], realPayments: false });
      await context.close();
    }
    await writeFile(path.join(evidence, "results.json"), JSON.stringify(results, null, 2));
    await writeFile(path.join(evidence, "pricing-head.html"), markup.match(/<head>[\s\S]*?<\/head>/)?.[0] ?? "");
    console.log(JSON.stringify(results));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
