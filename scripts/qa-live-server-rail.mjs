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
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, items: [] }));
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
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      railCards: document.querySelectorAll(".dzn-live-server-card").length,
      emptyStates: document.querySelectorAll(".dzn-live-server-rail__empty").length,
      text: document.querySelector(".dzn-live-server-rail")?.textContent ?? "",
    }));
    assert.equal(metrics.overflow, false, `Empty server rail must not overflow at ${width}px`);
    assert.equal(metrics.railCards, 0, "An empty API response must not create server cards.");
    assert.equal(metrics.emptyStates, 1, "An empty API response must render one truthful empty state.");
    assert.equal(metrics.text.includes("No public server listings are available right now"), true);
    assert.equal(metrics.text.includes("Beta onboarding"), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `empty-${width}.png`), fullPage: true });
    await writeFile(path.join(output, `empty-${width}.json`), JSON.stringify(metrics, null, 2));
    await context.close();
  }
  console.log("Live server rail rendered QA passed at phone and desktop widths.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
