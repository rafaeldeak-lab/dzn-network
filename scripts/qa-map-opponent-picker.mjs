import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const port = Number(process.env.DZN_MAP_QA_PORT ?? 3108), origin = `http://127.0.0.1:${port}`;
const output = path.resolve("artifacts/map-opponent-picker"), root = path.resolve("out");
const html = await readFile(path.join(root, "leaderboards.html"), "utf8");
const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(match => `<link rel="stylesheet" href="${match[1]}">`).join("");
const fixture = `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {DashboardServerWarsPanel} from './components/onboarding/dashboard';
import {ServerAdvancedShowcasePanel} from './components/network/public-network';
const rows=Array.from({length:40},(_,i)=>({cellX:(i*13)%128,cellY:(i*29)%128,visits:1+i%12}));
const advanced={access:{effectivePlan:'premium',publicExplorationSummary:true,publicBuildShowcase:true,publicTravelShowcase:true},exploration:{supported:true,mapDisplayName:'ChernarusPlus',gridSize:128,exploredCellsCount:479,totalExplorableCells:16384,explorationPercent:2.92,overlayCells:rows,estimated:true},boards:[{metricKey:'travel',title:'Most travelled server',description:'Estimated valid movement distance.',category:'travel',packageRequired:'premium',estimated:true,rows:[{rank:1,serverName:'Long server name that should stay readable on a narrow phone',displayValue:'80.7 km'}]}]};
const rules=[{key:'deathmatch_war',title:'Deathmatch War'},{key:'combat_war',title:'Combat War'}];
function App(){const [id,setId]=useState('source');return <main style={{maxWidth:1000,margin:'auto',padding:16}}><button id='switch-fixture' onClick={()=>setId(id==='source'?'second':'source')}>Switch fixture server</button><DashboardServerWarsPanel wars={{server:{id,name:'QA server'},access:{canCreateChallenge:true,effectivePlan:'pro'},eligibility:{category:'deathmatch',eligibleRulesets:id==='second'?rules.slice(1):rules},events:[],trophies:[],pendingChallenges:[]}} loading={false} error=""/><ServerAdvancedShowcasePanel server={{server_name:'QA DayZ Server'}} payload={advanced} loading={false} error=""/></main>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  const url = new URL(request.url, origin);
  if (url.pathname === "/") { response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`); return; }
  if (url.pathname === "/fixture.js") { response.writeHead(200, { "content-type": "text/javascript" }).end(bundle.outputFiles[0].contents); return; }
  if (url.pathname.endsWith("/wars/opponents")) { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, servers: [{ id: "choice", name: "QA eligible DayZ opponent", category: "deathmatch" }], nextOffset: null })); return; }
  const file = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
  if (!file.startsWith(root + path.sep) || !(await stat(file).catch(() => null))?.isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream" }).end(await readFile(file));
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
if (process.argv.includes("--serve")) console.log(`Synthetic map and opponent preview: ${origin}`);
else {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [320, 390, 900, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = [], writes = [], requests = [];
      page.on("pageerror", e => errors.push(e.message));
      let fail = false;
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (!["GET", "HEAD"].includes(request.method())) { writes.push(request.method()); await route.abort(); return; }
        if (url.origin !== origin) { await route.abort(); return; }
        if (!url.pathname.endsWith("/wars/opponents")) { await route.continue(); return; }
        requests.push(url.pathname + url.search);
        if (fail) { await route.fulfill({ status: 503, json: { ok: false } }); return; }
        const search = url.searchParams.get("search");
        await route.fulfill({ json: { ok: true, servers: search === "missing" ? [] : [{ id: "choice", name: "A very long eligible server name without truncation or a typed ID", category: "deathmatch" }], nextOffset: search === "pages" && url.searchParams.get("offset") === "0" ? 100 : null } });
      });
      await page.goto(origin, { waitUntil: "networkidle" });
      if (errors.length) throw new Error(JSON.stringify(errors));
      const choice = page.getByRole("radio");
      await choice.waitFor();
      const submit = page.getByRole("button", { name: "Create Challenge", exact: true });
      assert.equal(await submit.isEnabled(), false);
      await choice.check(); assert.equal(await submit.isEnabled(), true);
      await page.getByLabel("Ruleset", { exact: true }).selectOption("combat_war");
      assert.equal(await submit.isEnabled(), false); await choice.waitFor();
      await choice.check(); await page.locator("#switch-fixture").click();
      assert.equal(await submit.isEnabled(), false, "Changing server cannot reuse an opponent selection");
      assert.equal(await page.getByLabel("Ruleset", { exact: true }).inputValue(), "combat_war", "The new server starts with one of its eligible rulesets");
      await page.locator("#switch-fixture").click();
      assert.equal(await submit.isEnabled(), false, "Returning to a server cannot restore an old opponent selection");
      await choice.waitFor(); await choice.check();
      await page.getByRole("searchbox").fill("missing");
      assert.equal(await submit.isEnabled(), false);
      await page.getByText(/No eligible servers found for this name/).waitFor();
      await page.getByRole("searchbox").fill("pages");
      await page.getByRole("button", { name: "More servers" }).click();
      await page.getByRole("button", { name: "Previous servers" }).waitFor();
      assert.ok(requests.some(request => request.includes("offset=100")));
      fail = true; await page.getByRole("searchbox").fill("failure");
      await page.getByRole("alert").waitFor(); assert.equal(await submit.isEnabled(), false);
      fail = false; await page.getByRole("button", { name: "Retry server search" }).click(); await choice.waitFor();
      assert.match(await page.locator(".dzn-advanced-showcase").innerText(), /Chernarus/i);
      assert.doesNotMatch(await page.locator(".dzn-advanced-showcase").innerText(), /Premium\+|ChernarusPlus|dayzOffline/);
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, cells: [...document.querySelectorAll(".dzn-exploration-mini-grid span")].length, grid: getComputedStyle(document.querySelector(".dzn-exploration-mini-grid")).backgroundImage }));
      assert.equal(layout.overflow, false); assert.equal(layout.cells, 40); assert.match(layout.grid, /repeating-linear-gradient/);
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      await page.screenshot({ path: path.join(output, `panels-${width}.png`), fullPage: true });
      results.push({ width, ...layout, errors, writes }); await context.close();
    }
    await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log("Map and real dashboard-panel component QA passed at four widths; no challenge sent.");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
