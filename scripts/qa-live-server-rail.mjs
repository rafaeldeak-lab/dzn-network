import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const port = Number(process.env.DZN_SERVER_RAIL_QA_PORT ?? 3112);
const origin = `http://127.0.0.1:${port}`;
const root = path.resolve("out");
const output = path.resolve("artifacts/live-server-rail");
const html = await readFile(path.join(root, "index.html"), "utf8");
const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map((match) => `<link rel="stylesheet" href="${match[1]}">`).join("");
const fixture = "import React from 'react';import{createRoot}from'react-dom/client';import{LiveServerRail}from'./components/servers/live-server-rail';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'40px auto',padding:'0 16px'}}><LiveServerRail/></main>);";
const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const realServer = { id: "server-one", slug: "nuketown-deathmatch", name: "NukeTown DEATHMATCH", logoUrl: null, category: "Deathmatch", currentPlayers: 0, maxPlayers: 10, playerCountStatus: "fresh", ratingAverage: 4.8, reviewCount: 28, listingPlanKey: "pro", isPro: true };
const secondServer = { ...realServer, id: "server-two", slug: "second-server", name: "Second Server" };
let railMode = "normal";
let refreshRequestCount = 0;

const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
    return;
  }
  if (url.pathname === "/fixture.js") {
    response.writeHead(200, { "content-type": "text/javascript" }).end(bundle.outputFiles[0].contents);
    return;
  }
  if (url.pathname === "/api/public/server-rail") {
    refreshRequestCount += 1;
    const staleRefresh = railMode === "preserve" && refreshRequestCount > 1;
    const items = staleRefresh
      ? []
      : railMode === "refresh" && refreshRequestCount === 1
        ? [{ ...realServer, currentPlayers: null, maxPlayers: null, playerCountStatus: "stale" }]
        : [realServer, secondServer, { ...realServer, id: "legacy-duplicate" }];
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, items, generated_at: new Date().toISOString(), stale: staleRefresh }));
    return;
  }
  const file = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
  if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file).catch(() => null))?.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream" }).end(await readFile(file));
});

await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { width, reducedMotion } of [
    { width: 390, reducedMotion: "no-preference" },
    { width: 1440, reducedMotion: "no-preference" },
    { width: 390, reducedMotion: "reduce" },
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      railCards: document.querySelectorAll(".dzn-live-server-card").length,
      uniqueCardIds: [...document.querySelectorAll("[data-rail-card-id]")].map((card) => card.getAttribute("data-rail-card-id")),
      status: document.querySelector(".dzn-live-server-rail__header span:last-child")?.textContent?.trim() ?? "",
      animationName: getComputedStyle(document.querySelector(".dzn-live-server-rail__track")).animationName,
      animationTransforms: (() => {
        const track = document.querySelector(".dzn-live-server-rail__track");
        const animation = track?.getAnimations()[0];
        if (!animation || !track) return [];
        animation.currentTime = 0;
        const start = getComputedStyle(track).transform;
        animation.currentTime = 42_000;
        return [start, getComputedStyle(track).transform];
      })(),
      text: document.querySelector(".dzn-live-server-rail")?.textContent ?? "",
    }));
    assert.equal(metrics.overflow, false, `Empty server rail must not overflow at ${width}px`);
    assert.equal(metrics.railCards, 2, "Duplicate API identities must render once while distinct servers remain visible.");
    assert.deepEqual(metrics.uniqueCardIds, ["nuketown-deathmatch", "second-server"]);
    assert.equal(metrics.text.includes("0/10"), true, "Zero online players should render as fresh live data.");
    assert.equal(metrics.status, "Latest server data");
    if (reducedMotion === "reduce") assert.equal(metrics.animationName, "none", "Reduced-motion users should not receive rail animation.");
    else {
      assert.notEqual(metrics.animationName, "none", "The deduplicated rail should retain motion.");
      assert.notEqual(metrics.animationTransforms[0], metrics.animationTransforms[1], `A short multi-card rail must visibly move at ${width}px.`);
    }
    assert.equal(metrics.text.includes("Beta onboarding"), false);
    assert.deepEqual(errors, []);
    const label = `${width}-${reducedMotion}`;
    await page.screenshot({ path: path.join(output, `deduplicated-${label}.png`), fullPage: true });
    await writeFile(path.join(output, `deduplicated-${label}.json`), JSON.stringify(metrics, null, 2));
    await context.close();
  }
  railMode = "refresh";
  refreshRequestCount = 0;
  const refreshContext = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const refreshPage = await refreshContext.newPage();
  await refreshPage.goto(origin, { waitUntil: "networkidle" });
  assert.equal((await refreshPage.locator(".dzn-live-server-rail").innerText()).includes("Players syncing"), true);
  await refreshPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await refreshPage.waitForFunction(() => document.querySelector(".dzn-live-server-rail")?.textContent?.includes("0/10"));
  assert.equal(await refreshPage.locator(".dzn-live-server-card").count(), 2, "A successful refresh should replace stale data without cloning cards.");
  await refreshContext.close();
  railMode = "preserve";
  refreshRequestCount = 0;
  const preserveContext = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const preservePage = await preserveContext.newPage();
  await preservePage.goto(origin, { waitUntil: "networkidle" });
  await preservePage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await preservePage.waitForFunction(() => document.querySelector(".dzn-live-server-rail__header span:last-child")?.textContent?.includes("Latest data unavailable"));
  assert.equal(await preservePage.locator(".dzn-live-server-card").count(), 2, "A stale empty refresh must retain the last known-good cards.");
  assert.equal((await preservePage.locator(".dzn-live-server-rail").innerText()).includes("0/10"), true, "A stale empty refresh must retain the last known-good live count.");
  await preserveContext.close();
  railMode = "normal";
  const unavailableContext = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const unavailablePage = await unavailableContext.newPage();
  await unavailablePage.route("**/api/public/server-rail", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, items: [], stale: true }),
  }));
  await unavailablePage.goto(origin, { waitUntil: "networkidle" });
  const unavailableMetrics = await unavailablePage.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    railCards: document.querySelectorAll(".dzn-live-server-card").length,
    status: document.querySelector(".dzn-live-server-rail__header span:last-child")?.textContent?.trim() ?? "",
    text: document.querySelector(".dzn-live-server-rail")?.textContent ?? "",
  }));
  assert.equal(unavailableMetrics.overflow, false);
  assert.equal(unavailableMetrics.railCards, 0);
  assert.equal(unavailableMetrics.status, "Latest data unavailable");
  assert.equal(unavailableMetrics.text.includes("Server listings are temporarily unavailable"), true);
  assert.equal(unavailableMetrics.text.includes("No public server listings are available right now"), false);
  await unavailablePage.screenshot({ path: path.join(output, "unavailable-390.png"), fullPage: true });
  await writeFile(path.join(output, "unavailable-390.json"), JSON.stringify(unavailableMetrics, null, 2));
  await unavailableContext.close();
  console.log("Live server rail dedupe, motion, and unavailable-state QA passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
