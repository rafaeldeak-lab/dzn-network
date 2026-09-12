import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const evidence = process.env.DZN_STARTER_QA_OUTPUT ?? path.join(tmpdir(), "dzn-returning-starter-qa");
await mkdir(evidence, { recursive: true });
const root = path.resolve("out");
const dashboard = await readFile(path.join(root, "dashboard.html"), "utf8");
const css = [...dashboard.matchAll(/<link[^>]+href="([^"]+\.css[^"?]*)"[^>]*>/g)].map(match => `<link rel="stylesheet" href="${match[1]}">`).join("");
assert.ok(css, "Build the actual app CSS before rendered QA");
const source = await readFile("components/onboarding/dashboard.tsx", "utf8");
assert.match(source, /<StarterCheckoutButton/);
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
  import {StarterCheckoutButton} from './components/onboarding/starter-checkout-button';
  createRoot(document.getElementById('root')).render(<StarterCheckoutButton/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, jsx: "automatic", format: "esm", define: { "process.env.NODE_ENV": '"production"' } });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DZN Starter - local payment preview</title>${css}</head>
  <body style="margin:0;background:#050910;color:white;font-family:Arial,sans-serif"><main style="padding:24px;max-width:720px;margin:auto"><h1 style="font-size:24px">DZN Starter</h1><p style="margin:16px 0;color:#bbc5ce">Local preview only. No payment or account is connected.</p><div id="root"></div></main><script type="module" src="/preview.js"></script></body></html>`;
const confirmation = "a".repeat(64);
const offer = { id: "starter-gbp-2-month-no-trial-v1", confirmation, price_label: "GBP 2/month", terms: "GBP 2 now, then monthly. No new free trial." };
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/billing/create-checkout-session") {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Local preview: no payment will be created.", errorCode: "STARTER_PAID_CONFIRMATION_REQUIRED", offer })); return;
    }
    if (url.pathname === "/" || url.pathname === "/done") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    if (url.pathname === "/preview.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    const file = path.resolve(root, `.${url.pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(process.argv.includes("--serve") ? Number(process.env.PORT ?? 3088) : 0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`Local mock-only Starter preview: ${base}`);
if (!process.argv.includes("--serve")) {
  const { chromium } = await import(process.env.DZN_QA_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DZN_QA_PLAYWRIGHT_PATH).href : "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  try {
    for (const width of [1440, 900, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : 900 }, reducedMotion: "reduce" });
      const page = await context.newPage(); const errors = []; const sent = []; let outcome = "offer"; let release;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, base, "No external requests, analytics or actual Stripe navigation");
        if (url.pathname === "/api/billing/create-checkout-session") {
          const body = JSON.parse(route.request().postData()); sent.push(body);
          assert.equal(route.request().method(), "POST");
          if (outcome === "waiting") { await new Promise(resolve => { release = resolve; }); }
          if (outcome === "success") return route.fulfill({ json: { url: `${base}/done` } });
          if (outcome === "error") return route.fulfill({ status: 503, json: { error: "We could not confirm checkout yet. Please try again.", errorCode: "CHECKOUT_RETRY_REQUIRED" } });
          if (outcome === "paused") return route.fulfill({ status: 403, json: { error: "Live checkout is paused.", errorCode: "LIVE_CHECKOUT_PAUSED" } });
          return route.fulfill({ status: 409, json: { errorCode: "STARTER_PAID_CONFIRMATION_REQUIRED", offer } });
        }
        return route.continue();
      });
      await page.goto(base);
      const choose = page.getByRole("button", { name: "Choose Starter" });
      await choose.focus(); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Return to Starter" }); await dialog.waitFor();
      assert.equal(sent.length, 1); assert.equal(sent[0].accepted_offer, undefined);
      assert.equal(await page.getByRole("checkbox").isChecked(), false);
      const next = page.getByRole("button", { name: "Continue to Stripe" }); assert.equal(await next.isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Close checkout confirmation" }).evaluate(el => el === document.activeElement), true);
      assert.match(await dialog.textContent(), /£2 is due when you confirm payment in Stripe/);
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(evidence, `confirmation-${width}.png`), fullPage: true });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      assert.equal(sent.length, 1, "Dismissal cannot submit payment");
      assert.equal(await choose.evaluate(el => el === document.activeElement), true);
      await choose.click(); await dialog.waitFor();
      await page.getByRole("checkbox").focus(); await page.keyboard.press("Space");
      await next.focus(); outcome = "waiting"; await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Opening checkout..." }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Opening checkout..." }).isDisabled(), true);
      assert.equal(sent.at(-1).accepted_offer, confirmation);
      outcome = "error"; release(); await page.getByRole("alert").waitFor();
      await page.screenshot({ path: path.join(evidence, `retry-error-${width}.png`), fullPage: true });
      assert.equal(await page.getByRole("checkbox").isChecked(), true, "Retry keeps the same terms acknowledged");
      outcome = "offer"; await next.click(); await page.waitForFunction(() => !document.querySelector('input[type="checkbox"]').checked);
      assert.equal(await next.isDisabled(), true, "Refreshed offer requires another explicit acknowledgement");
      await page.getByRole("checkbox").check(); outcome = "success"; await next.click(); await page.waitForURL(`${base}/done`);
      outcome = "paused"; await choose.click(); await page.getByRole("alert").filter({ hasText: "Live checkout is paused" }).waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      results.push({ width, passed: true, calls: sent.length, pageErrors: errors, scenarios: ["keyboard", "unchecked-default", "cancel", "no-overflow", "busy", "retry", "renewed-consent", "mock-redirect", "live-paused", "no-storage", "no-external-network"] });
      await context.close();
    }
    await writeFile(path.join(evidence, "results.json"), JSON.stringify({ localMockOnly: true, generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`Returning Starter rendered QA passed. Evidence: ${evidence}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
