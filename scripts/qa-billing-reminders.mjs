import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const evidence = process.env.DZN_REMINDER_QA_OUTPUT ?? path.join(tmpdir(), "dzn-payment-reminder-qa");
const trialMode = process.argv.includes("--trial");
await mkdir(evidence, { recursive: true });
const root = path.resolve("out");
const dashboard = await readFile(path.join(root, "dashboard.html"), "utf8");
const css = [...dashboard.matchAll(/<link[^>]+href="([^"]+\.css[^"?]*)"[^>]*>/g)].map(match => `<link rel="stylesheet" href="${match[1]}">`).join("");
assert.ok(css, "Build the actual app CSS before rendered QA");
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {DznPulseProvider,DznPulseBell} from './components/dzn-pulse/dzn-pulse-provider';
    createRoot(document.getElementById('root')).render(<DznPulseProvider enablePopups={false}><DznPulseBell/></DznPulseProvider>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, jsx: "automatic", format: "esm", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "local-next-shell", setup(build) {
    build.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "local-next" }));
    build.onLoad({ filter: /.*/, namespace: "local-next" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
      ? "import React from 'react'; export default function Link(props) { return <a {...props}/>; }"
      : "export const usePathname=()=>location.pathname; export const useRouter=()=>({push: url=>location.assign(url)});" }));
  } }],
});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DZN private billing notice - local preview</title>${css}</head>
  <body style="margin:0;background:#050910;color:white;font-family:Arial,sans-serif"><main style="padding:24px;max-width:720px;margin:auto"><h1 style="font-size:24px">DZN notifications</h1><p style="margin:16px 0;color:#bbc5ce">Local preview only. No customer account or payment is connected.</p><div id="root"></div></main><script type="module" src="/preview.js"></script></body></html>`;
const pausedBody = "Starter payment setup is temporarily unavailable while billing checks are completed. Your trial has not started. Review the owner plans for the current checkout status.";
const availableBody = "Starter includes a two-day trial, then GBP 2/month. Review the terms and enter your card details in Stripe. This reminder does not start a trial or charge you.";
const source = await readFile("functions/_lib/billing-reminders.ts", "utf8");
assert.ok(source.includes(pausedBody) && source.includes(availableBody), "Preview copy must match the actual server contract");
function item(available = false) { return {
  id: "synthetic-owner-notice", type: "billing_payment_setup", category: "billing", category_label: "Billing",
  title: "Please set up payment", body: available ? availableBody : pausedBody, action_url: "/pricing?intent=owner_setup&returnTo=%2Fsetup",
  server_id: null, event_id: null, server_name: null, event_name: null, image_url: null, read_at: null,
  created_at: new Date().toISOString(), expires_at: null, metadata: { checkout_available: available },
}; }
const trialEnd = new Date(Math.floor(Date.now() / 1000) * 1000 + 3600000).toISOString();
const deadline = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(trialEnd));
const trialTitle = "Your Starter trial ends within one day";
const trialSource = await readFile("functions/_lib/billing-trial-reminders.ts", "utf8");
assert.ok(trialSource.includes(trialTitle) && trialSource.includes('action_url: "/dashboard"'));
function visibleItem(available = false) {
  return trialMode ? { ...item(available), type: "billing_trial_ending", title: trialTitle,
    body: `Your trial ends on ${deadline} UTC. Review your Starter billing and cancellation options in your dashboard before it ends.`,
    action_url: "/dashboard", metadata: { trial_ends_at: trialEnd } } : item(available);
}
let previewRead = false, previewCleared = false;
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      const count = previewRead || previewCleared ? 0 : 1;
      let payload = { ok: true };
      if (url.pathname.endsWith("/config")) payload = { ok: true, dznPulseEnabled: true, billingRemindersEnabled: true };
      else if (url.pathname.endsWith("/unread-count")) payload = { ok: true, unreadCount: count };
      else if (url.pathname.endsWith("/read-all") || url.pathname.endsWith("/read")) previewRead = true;
      else if (url.pathname.endsWith("/clear-read")) previewCleared = previewRead;
      else if (url.pathname.endsWith("/notifications")) payload = { ok: true, items: previewCleared ? [] : [{ ...visibleItem(), read_at: previewRead ? new Date().toISOString() : null }], unreadCount: count };
      else if (!url.pathname.endsWith("/refresh-billing")) { res.statusCode = 404; payload = { ok: false }; }
      res.end(JSON.stringify(payload)); return;
    }
    if (["/", "/pricing", "/dashboard"].includes(url.pathname)) { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    if (url.pathname === "/preview.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    const file = path.resolve(root, `.${url.pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) || !file.endsWith(".css")) throw new Error("Invalid asset");
    res.setHeader("Content-Type", "text/css"); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(process.argv.includes("--serve") ? Number(process.env.PORT ?? 3089) : 0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`Local mock-only billing notice: ${base}`);
if (!process.argv.includes("--serve")) {
  const { chromium } = await import(process.env.DZN_QA_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DZN_QA_PLAYWRIGHT_PATH).href : "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true }); const results = [];
  try {
    for (const width of [1440, 900, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 900 }, reducedMotion: width <= 390 ? "reduce" : "no-preference" });
      const page = await context.newPage(); const errors = []; const requests = [];
      let flag = false, available = false, eligible = true, read = false, cleared = false, refreshFailure = false, listFailure = false;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const request = route.request(); const url = new URL(request.url());
        assert.equal(url.origin, base, "No external network, tracking or payment provider");
        if (!url.pathname.startsWith("/api/")) return route.continue();
        requests.push({ path: url.pathname, method: request.method() });
        assert.ok(url.pathname.startsWith("/api/dzn-pulse/"), "Only private notification APIs");
        let payload = { ok: true }; let status = 200;
        const visible = flag && eligible && !cleared; const count = visible && !read ? 1 : 0;
        if (url.pathname.endsWith("/config")) payload = { ok: true, dznPulseEnabled: true, billingRemindersEnabled: flag };
        else if (url.pathname.endsWith("/refresh-billing")) { assert.equal(request.method(), "POST"); assert.deepEqual(request.postDataJSON(), {}); status = refreshFailure ? 503 : 200; }
        else if (url.pathname.endsWith("/unread-count")) payload = { ok: true, unreadCount: count };
        else if (url.pathname.endsWith("/notifications")) { status = listFailure ? 503 : 200; payload = listFailure ? { error: "Notifications are temporarily unavailable." } : { ok: true, items: visible ? [{ ...visibleItem(available), read_at: read ? new Date().toISOString() : null }] : [], unreadCount: count }; }
        else if (url.pathname.endsWith("/read-all") || url.pathname.endsWith("/read")) read = true;
        else if (url.pathname.endsWith("/clear-read")) cleared = read;
        else assert.fail(`Unexpected request: ${url.pathname}`);
        return route.fulfill({ status, json: payload });
      });
      const bell = page.getByRole("button", { name: /Open DZN Pulse notifications/ });
      const dialog = page.getByRole("dialog");
      const notice = page.getByRole("button", { name: trialMode ? /Your Starter trial ends within one day/ : /Please set up payment/ });
      await page.goto(base); await bell.click(); await page.getByText("You're all caught up.", { exact: true }).waitFor();
      assert.equal(requests.filter(r => r.path.endsWith("refresh-billing")).length, 0, "A page loaded with the flag off cannot refresh billing");
      flag = true; await page.reload(); await page.getByRole("button", { name: /1 unread/ }).waitFor();
      const badgeColor = await bell.locator("span").evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(badgeColor, "rgba(0, 0, 0, 0)");
      await bell.focus(); await page.keyboard.press("Enter"); await dialog.waitFor();
      await notice.waitFor(); await page.getByRole("button", { name: "Billing", exact: true }).click();
      await notice.waitFor(); assert.match(await notice.textContent(), trialMode ? /UTC/ : /trial has not started/);
      assert.equal(await page.getByRole("button", { name: "Billing", exact: true }).getAttribute("aria-pressed"), "true");
      for (const name of ["All", "Events", "Scores", "Achievements", "News", "Billing"]) {
        assert.equal(await page.getByRole("button", { name, exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth), true, `${name} must fit without clipping`);
      }
      const billingTab = page.getByRole("button", { name: "Billing", exact: true });
      await billingTab.focus(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForResponse(response => response.url().includes("/notifications?"));
      assert.equal(await billingTab.evaluate(el => el === document.activeElement), true, "Refresh must not steal keyboard focus");
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(evidence, `paused-${width}.png`), fullPage: true, animations: "disabled" });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.hasAttribute("data-dzn-pulse-bell"));
      await bell.click(); await notice.waitFor();
      await page.getByRole("button", { name: "Mark all as read" }).click();
      await page.getByRole("button", { name: "Clear read notifications" }).click();
      await notice.waitFor({ state: "hidden" }); await page.reload(); await bell.click();
      await page.getByText("You're all caught up.", { exact: true }).waitFor();
      await page.screenshot({ path: path.join(evidence, `cleared-${width}.png`), fullPage: true, animations: "disabled" });
      cleared = false; read = false; available = true;
      await page.reload(); await bell.click(); await notice.waitFor(); assert.match(await notice.textContent(), trialMode ? /cancellation options/ : /GBP 2\/month/);
      await page.screenshot({ path: path.join(evidence, `available-${width}.png`), fullPage: true, animations: "disabled" });
      await notice.focus(); await page.keyboard.press("Enter"); await page.waitForURL(`${base}${trialMode ? "/dashboard" : "/pricing?intent=owner_setup&returnTo=%2Fsetup"}`);
      assert.equal(read, true);
      eligible = false; await page.reload(); await bell.click(); await page.getByText("You're all caught up.", { exact: true }).waitFor();
      eligible = true; refreshFailure = true;
      await page.reload(); await bell.click(); await notice.waitFor();
      listFailure = true; await page.reload(); await bell.click(); await page.getByRole("button", { name: /retry/i }).waitFor();
      await page.screenshot({ path: path.join(evidence, `unavailable-${width}.png`), fullPage: true, animations: "disabled" });
      listFailure = false; await page.getByRole("button", { name: /retry/i }).click(); await notice.waitFor();
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      results.push({ width, passed: true, badgeColor, pageErrors: errors, apiRequests: requests.length, scenarios: ["keyboard-open-close-focus", "billing-filter", trialMode ? "verified-deadline-copy" : "paused-copy", "no-overflow", "read-clear-repeat-visit", trialMode ? "cancellation-options-copy" : "available-copy", trialMode ? "dashboard-navigation-only" : "pricing-navigation-only", "ineligible-hidden", "flag-off-no-write", "refresh-failure-isolated", "list-error-retry", "no-storage-or-external-network"] });
      await context.close();
    }
    await writeFile(path.join(evidence, "results.json"), JSON.stringify({ localMockOnly: true, reminder: trialMode ? "trial-ending" : "payment-setup", trialEnd: trialMode ? trialEnd : null, generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`Private billing reminder rendered QA passed. Evidence: ${evidence}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
