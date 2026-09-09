import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve("out");
const output = path.resolve("artifacts/mobile-leaderboards");
const port = Number(process.env.DZN_MOBILE_QA_PORT ?? 3106);
const origin = `http://127.0.0.1:${port}`;
const name = "Very_Long_Player_Name_With_No_Spaces_123456789";
const serverName = "A very long DayZ community server name that must remain readable";
const kill = { rank: 1, player_name: name, victim_name: "Another_Player_With_A_Long_Name", server_name: serverName, server_slug: "qa-server", weapon: "Mosin 91/30", distance: 106.7, occurred_at: "2026-09-09T06:00:00Z" };
const boards = { ok: true, top_servers: [{ rank: 1, server_id: "qa-server", server_name: serverName, slug: "qa-server", mode: "PVP / PVE", kills: 500, deaths: 200, kd: 2.5, kd_label: "2.50", longest_kill: 106.7, score: 1000, score_label: "1000", score_breakdown: null }], top_players: [{ ...kill, player_id: null, kills: 65, deaths: 20, kd: 3.25, kd_label: "3.25", longest_kill: 106.7 }], personal_best_kills: [kill], longest_kills: [kill], best_overall_kill: kill, latest_kill: kill, updated_at: "2026-09-09T06:00:00Z", access_level: "full", is_locked: false };
function api(url) {
  if (url.pathname === "/api/public/leaderboards") return boards;
  if (url.pathname === "/api/public/leaderboards/advanced") return { ok: true, boards: [], categories: [], notes: [] };
  if (url.pathname === "/api/public/server-wars") return { ok: true, events: [], rulesets: [], leaderboards: [], summary: {} };
  if (url.pathname === "/api/auth/me") return { authenticated: true, user: { id: "qa", username: "QA player" }, linkedServers: [], linkedServer: null };
  if (url.pathname === "/api/dzn-pulse/config") return { ok: true, dznPulseEnabled: false, billingRemindersEnabled: false, discordNotificationsEnabled: false };
  if (url.pathname === "/api/dzn-pulse") return { ok: true, items: [], unreadCount: 0 };
  return { ok: true, items: [], servers: [] };
}
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/x-component", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".ico": "image/x-icon" };
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    const url = new URL(request.url, origin);
    if (url.pathname.startsWith("/api/")) { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(api(url))); return; }
    const candidate = path.resolve(root, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1));
    if (!candidate.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    const segment = candidate.replace(/(__next\.[^./\\]+)((?:\.[^/\\]+)+)\.txt$/, (_, prefix, parts) => `${prefix}${parts.replaceAll(".", path.sep)}.txt`);
    for (const file of [candidate, segment, `${candidate}.html`, path.join(candidate, "index.html")]) {
      if ((await stat(file).catch(() => null))?.isFile()) { response.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream" }).end(await readFile(file)); return; }
    }
    response.writeHead(404).end();
  } catch { response.writeHead(500).end(); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
if (process.argv.includes("--serve")) {
  console.log(`Synthetic mobile leaderboard preview: ${origin}/leaderboards`);
} else {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [320, 390, 760, 900, 1440]) {
      for (const reducedMotion of ["reduce", "no-preference"]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion, timezoneId: "America/Los_Angeles" });
        const page = await context.newPage();
        const errors = [], failed = [], writes = [];
        page.on("pageerror", e => errors.push(e.message));
        page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
        page.on("response", r => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
        await page.route("**/*", route => {
          const request = route.request();
          const isRead = ["GET", "HEAD"].includes(request.method());
          if (!isRead) writes.push(request.method());
          return new URL(request.url()).origin === origin && isRead ? route.continue() : route.abort();
        });
        await page.goto(`${origin}/leaderboards`, { waitUntil: "networkidle" });
        await page.getByRole("table", { name: "Top Players", exact: true }).waitFor();
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          tickerPosition: getComputedStyle(document.querySelector(".dzn-beta-ticker")).position,
          tickerBottom: document.querySelector(".dzn-beta-ticker").getBoundingClientRect().bottom,
          mainTop: document.querySelector("main").getBoundingClientRect().top,
          tableOverflow: [...document.querySelectorAll(".dzn-leaderboard-table-wrap")].some(e => e.scrollWidth > e.clientWidth + 1),
          cells: [...document.querySelectorAll("td")].map(e => ({ label: e.dataset.label, text: e.textContent, display: getComputedStyle(e).display, width: e.getBoundingClientRect().width })),
          art: [...document.querySelectorAll(".leaderboard-ref-kill-art,.leaderboard-ref-kill-card-bg")].map(e => ({ width: e.getBoundingClientRect().width, height: getComputedStyle(e).height, parentWidth: e.parentElement.clientWidth })),
          animations: [...document.querySelectorAll(".leaderboard-ref-bullet-spark,.leaderboard-ref-kill-art")].map(e => getComputedStyle(e).animationName),
        }));
        assert.equal(layout.overflow, false, `Page overflow at ${width}`);
        assert.equal(layout.tickerPosition, "relative");
        assert.ok(layout.tickerBottom <= layout.mainTop + 1, "Notice must precede content, never overlay it");
        assert.ok(layout.cells.every(c => c.label && c.display !== "none" && c.width > 0), "All original metrics remain visible and labelled");
        if (width <= 760) {
          assert.equal(layout.tableOverflow, false, "No sideways mobile table scroll");
          assert.ok(layout.art.every(a => a.width >= a.parentWidth - 3 && a.height === "116px"), JSON.stringify(layout.art));
        }
        if (reducedMotion === "reduce") assert.ok(layout.animations.every(a => a === "none"));
        else assert.ok(layout.animations.some(a => a !== "none"), "Projectile effects preserved");
        for (const asset of ["sniper-accent.png", "rifle-accent.png", "bullet-tracer-accent.png"]) {
          const result = await page.evaluate(src => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0); img.src = src; }), `/leaderboards/${asset}`);
          assert.ok(result > 0, `Missing art ${asset}`);
        }
        await page.locator(".leaderboard-ref-area--longest").screenshot({ path: path.join(output, `records-${width}-${reducedMotion}.png`) });
        await page.locator(".leaderboard-ref-area--players").screenshot({ path: path.join(output, `players-${width}-${reducedMotion}.png`) });
        await page.locator(".leaderboard-ref-area--personal").screenshot({ path: path.join(output, `personal-${width}-${reducedMotion}.png`) });
        await page.getByRole("button", { name: "Hide beta notice" }).click();
        assert.equal(await page.locator(".dzn-beta-ticker").count(), 0);
        await page.reload({ waitUntil: "networkidle" });
        assert.equal(await page.locator(".dzn-beta-ticker").count(), 0, "Dismissal survives reload");
        assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(writes, []);
        results.push({ width, reducedMotion, ...layout, errors, failed, writes });
        await context.close();
      }
    }
    await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(`Passed ${results.length} built desktop/mobile/reduced-motion cases with fixture-only reads.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
