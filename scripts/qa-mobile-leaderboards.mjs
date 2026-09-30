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
const avatarUrl = "/api/public/players/qa-player/avatar";
const kill = { rank: 1, player_name: name, victim_name: "Another_Player_With_A_Long_Name", server_name: serverName, server_slug: "qa-server", weapon: "Mosin 91/30", distance: 106.7, occurred_at: "2026-09-09T06:00:00Z", player_public_profile_href: "/players/qa-player", player_public_profile_avatar_url: avatarUrl };
const serverRow = { rank: 1, server_id: "qa-server", server_name: serverName, slug: "qa-server", mode: "HARDCORE", category: "pvp", kills: 500, deaths: 200, kd: 2.5, kd_label: "2.50", longest_kill: 106.7, unique_players: 142, score: 1000, score_label: "1000", score_breakdown: null };
const deathmatchRow = { ...serverRow, rank: 11, server_id: "qa-deathmatch", server_name: "QA Deathmatch", slug: "qa-deathmatch", mode: "DEATHMATCH", category: "deathmatch", score: 700, score_label: "700" };
const boards = { ok: true, top_servers: [serverRow], top_players: [{ ...kill, player_id: null, kills: 65, deaths: 20, kd: 3.25, kd_label: "3.25", longest_kill: 106.7, public_profile_href: "/players/qa-player", public_profile_avatar_url: avatarUrl }], personal_best_kills: [kill], longest_kills: [kill], best_overall_kill: kill, latest_kill: kill, updated_at: "2026-09-09T06:00:00Z", access_level: "full", is_locked: false };
const emptyPreviewBoards = { ...boards, top_servers: [], top_players: [], personal_best_kills: [], longest_kills: [], best_overall_kill: null, latest_kill: null, access_level: "preview", is_locked: true };
function api(url) {
  if (url.pathname === "/api/public/leaderboards") {
    if (url.searchParams.get("mode") === "pve") return emptyPreviewBoards;
    return { ...boards, top_servers: url.searchParams.get("mode") === "deathmatch" ? [deathmatchRow] : boards.top_servers };
  }
  if (url.pathname === "/api/public/leaderboards/advanced") return { ok: true, boards: [], categories: [], notes: [] };
  if (url.pathname === "/api/public/server-wars") return { ok: true, events: [], rulesets: [], leaderboards: [], summary: {} };
  if (url.pathname === "/api/auth/me") return { authenticated: true, user: { id: "qa", username: "QA player" }, linkedServers: [], linkedServer: null };
  if (url.pathname === "/api/dzn-pulse/config") return { ok: true, dznPulseEnabled: false, billingRemindersEnabled: false, discordNotificationsEnabled: false };
  if (url.pathname === "/api/dzn-pulse") return { ok: true, items: [], unreadCount: 0 };
  return { ok: true, items: [], servers: [] };
}
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/x-component", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".ico": "image/x-icon" };
let pveRequestCount = 0;
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    const url = new URL(request.url, origin);
    if (/^\/api\/public\/players\/[a-z0-9-]+\/avatar$/.test(url.pathname)) { response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(await readFile(path.join(root, "leaderboards", "sniper-accent.png"))); return; }
    if (url.pathname === "/api/public/leaderboards" && url.searchParams.get("mode") === "survival") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...boards, top_servers: [], source: "empty_no_cache", stale: true, fallback_reason: "live_query_failed_no_snapshot" })); return; }
    if (url.pathname === "/api/public/leaderboards" && url.searchParams.get("mode") === "pvp") await new Promise(resolve => setTimeout(resolve, 600));
    if (url.pathname === "/api/public/leaderboards" && url.searchParams.get("mode") === "pve" && ++pveRequestCount > 1) await new Promise(resolve => setTimeout(resolve, 600));
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
    for (const width of process.argv.includes("--auth-only") ? [] : [320, 390, 760, 900, 1440]) {
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
        await page.getByRole("table", { name: "Top Servers", exact: true }).waitFor();
        await page.locator('[data-board-view="servers"]').screenshot({ path: path.join(output, `servers-${width}-${reducedMotion}.png`) });
        await page.getByRole("button", { name: "PvP", exact: true }).click();
        assert.equal(await page.getByRole("table", { name: "Top Servers", exact: true }).count(), 0, "A selected mode must not render the previous mode's table while loading");
        assert.ok(await page.locator(".dzn-leaderboard-card .animate-pulse").count() > 0, "A delayed successful mode request must show a loading state");
        assert.equal(await page.getByRole("button", { name: "All Modes", exact: true }).count(), 1, "Mode controls must remain mounted while results load");
        assert.equal(await page.getByRole("tab", { name: "Players", exact: true }).count(), 1, "Board controls must remain mounted while results load");
        await page.getByRole("table", { name: "Top Servers", exact: true }).waitFor();
        await page.getByText(serverName, { exact: true }).waitFor();
        await page.getByRole("button", { name: "Deathmatch", exact: true }).click();
        await page.getByText("QA Deathmatch", { exact: true }).waitFor();
        assert.equal(await page.locator('td[data-label="Rank"]').innerText(), "#11", "Mode views must preserve global ranks outside the overall top ten");
        await page.getByRole("tab", { name: "Players", exact: true }).click();
        await page.getByRole("table", { name: "Top Players", exact: true }).waitFor();
        await page.locator('img[src*="/api/public/players/"]').first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('img[src*="/api/public/players/"]')].some(image => image.naturalWidth > 0));
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          playerPanelWidth: document.querySelector('.leaderboard-ref-area--players').getBoundingClientRect().width,
          betaNoticeCount: document.querySelectorAll(".dzn-beta-ticker").length,
          tableOverflow: [...document.querySelectorAll(".dzn-leaderboard-table-wrap")].some(e => e.scrollWidth > e.clientWidth + 1),
          cells: [...document.querySelectorAll("td")].map(e => ({ label: e.dataset.label, text: e.textContent, display: getComputedStyle(e).display, width: e.getBoundingClientRect().width })),
          avatarLoaded: [...document.querySelectorAll('img[src*="/api/public/players/"]')].some(e => e.naturalWidth > 0),
        }));
        assert.equal(layout.overflow, false, `Page overflow at ${width}`);
        assert.ok(layout.playerPanelWidth >= width - 40, `Player panel must fill the narrow viewport at ${width}px; rendered ${layout.playerPanelWidth}px`);
        assert.equal(layout.betaNoticeCount, 0, "The retired beta notice must not consume public-page space");
        assert.ok(layout.cells.every(c => c.label && c.display !== "none" && c.width > 0), "All original metrics remain visible and labelled");
        if (width <= 760) {
          assert.equal(layout.tableOverflow, false, "No sideways mobile table scroll");
        }
        assert.equal(layout.avatarLoaded, true, "Consented Discord avatar proxy image must render");
        for (const asset of ["sniper-accent.png", "rifle-accent.png", "bullet-tracer-accent.png"]) {
          const result = await page.evaluate(src => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0); img.src = src; }), `/leaderboards/${asset}`);
          assert.ok(result > 0, `Missing art ${asset}`);
        }
        await page.locator(".leaderboard-ref-area--players").screenshot({ path: path.join(output, `players-${width}-${reducedMotion}.png`) });
        await page.getByRole("tab", { name: "Records", exact: true }).click();
        await page.getByRole("table", { name: "Personal best kills", exact: true }).waitFor();
        const recordsLayout = await page.evaluate(() => ({
          art: [...document.querySelectorAll(".leaderboard-ref-kill-art,.leaderboard-ref-kill-card-bg")].map(e => ({ width: e.getBoundingClientRect().width, height: getComputedStyle(e).height, parentWidth: e.parentElement.clientWidth })),
          animations: [...document.querySelectorAll(".leaderboard-ref-bullet-spark,.leaderboard-ref-kill-art")].map(e => getComputedStyle(e).animationName),
        }));
        assert.ok(recordsLayout.art.length > 0, "Records artwork must be mounted before visual assertions");
        assert.ok(recordsLayout.animations.length > 0, "Records effects must be mounted before motion assertions");
        if (width <= 760) assert.ok(recordsLayout.art.every(a => a.width >= a.parentWidth - 3 && a.height === "116px"), JSON.stringify(recordsLayout.art));
        if (reducedMotion === "reduce") assert.ok(recordsLayout.animations.every(a => a === "none"));
        else assert.ok(recordsLayout.animations.some(a => a !== "none"), "Normal-motion records must keep at least one active effect");
        await page.locator(".leaderboard-ref-area--longest").screenshot({ path: path.join(output, `records-${width}-${reducedMotion}.png`) });
        await page.locator(".leaderboard-ref-area--personal").screenshot({ path: path.join(output, `personal-${width}-${reducedMotion}.png`) });
        assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(writes, []);
        results.push({ width, reducedMotion, ...layout, ...recordsLayout, errors, failed, writes });
        await context.close();
      }
    }
    if (!process.argv.includes("--auth-only")) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await page.goto(`${origin}/leaderboards`, { waitUntil: "networkidle" });
      await page.getByRole("table", { name: "Top Servers", exact: true }).waitFor();
      await page.getByRole("button", { name: "Survival", exact: true }).click();
      await page.getByText("Survival rankings could not be loaded right now.", { exact: true }).waitFor();
      assert.equal(await page.getByRole("table", { name: "Top Servers", exact: true }).count(), 0, "An empty_no_cache mode response must not reuse another mode's server table");
      await page.getByRole("button", { name: "Survival", exact: true }).click();
      await page.getByText("Survival rankings could not be loaded right now.", { exact: true }).waitFor();
      assert.equal(await page.locator(".dzn-leaderboard-card .animate-pulse").count(), 0, "Reselecting a failed active mode must not hide its recovery state");
      await page.getByRole("tab", { name: "Players", exact: true }).click();
      await page.getByRole("table", { name: "Top Players", exact: true }).waitFor();
      await context.close();
      results.push({ route: "leaderboards-mode-failure", width: 390, mode: "survival", surfaced: true });

      const reverseContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      const reversePage = await reverseContext.newPage();
      await reversePage.goto(`${origin}/leaderboards`, { waitUntil: "networkidle" });
      await reversePage.getByRole("button", { name: "PvP", exact: true }).click();
      await reversePage.getByRole("table", { name: "Top Servers", exact: true }).waitFor();
      await reversePage.evaluate(key => localStorage.removeItem(key), "dzn:lastGoodLeaderboard");
      await reversePage.route("**/api/public/leaderboards", route => route.fulfill({ json: { ...boards, top_servers: [], source: "empty_no_cache", stale: true, fallback_reason: "live_query_failed_no_snapshot" } }));
      await reversePage.getByRole("button", { name: "All Modes", exact: true }).click();
      await reversePage.getByText("Leaderboard data is temporarily unavailable.", { exact: true }).waitFor();
      assert.equal(await reversePage.getByRole("table", { name: "Top Servers", exact: true }).count(), 0, "A failed all-mode request must not reuse a filtered payload");
      assert.equal(await reversePage.locator(".dzn-leaderboard-card .animate-pulse").count(), 0, "A failed reverse transition must leave the loading state");
      await reverseContext.close();
      results.push({ route: "leaderboards-all-mode-failure", width: 390, surfaced: true });

      const emptyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      const emptyPage = await emptyContext.newPage();
      await emptyPage.clock.install();
      await emptyPage.goto(`${origin}/leaderboards`, { waitUntil: "networkidle" });
      await emptyPage.getByRole("button", { name: "PvE", exact: true }).click();
      await emptyPage.getByText("No ranked PvE servers yet.", { exact: true }).waitFor();
      await emptyPage.getByRole("button", { name: "PvP", exact: true }).click();
      assert.equal(await emptyPage.getByRole("button", { name: "All Modes", exact: true }).count(), 1, "Mode controls must remain mounted when leaving an empty mode");
      assert.equal(await emptyPage.getByRole("tab", { name: "Players", exact: true }).count(), 1, "Board controls must remain mounted when leaving an empty mode");
      assert.ok(await emptyPage.locator(".dzn-leaderboard-card .animate-pulse").count() > 0, "Leaving an empty mode must scope loading to the server results");
      await emptyPage.getByRole("table", { name: "Top Servers", exact: true }).waitFor();
      await emptyPage.getByRole("button", { name: "PvE", exact: true }).click();
      await emptyPage.getByText("No ranked PvE servers yet.", { exact: true }).waitFor();
      await emptyPage.clock.runFor(30_000);
      assert.equal(await emptyPage.getByRole("button", { name: "All Modes", exact: true }).count(), 1, "Mode controls must remain mounted while an empty mode refreshes");
      assert.equal(await emptyPage.getByRole("tab", { name: "Players", exact: true }).count(), 1, "Board controls must remain mounted while an empty mode refreshes");
      assert.equal(await emptyPage.getByText("No ranked PvE servers yet.", { exact: true }).count(), 1, "A legitimate empty result must remain visible while it refreshes");
      await emptyContext.close();
      results.push({ route: "leaderboards-empty-mode-refresh", width: 390, controlsMounted: true });
    }
    for (const width of [320, 390]) {
      for (const routeName of ["login", "signup"]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = [], writes = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", route => {
          const request = route.request(), url = new URL(request.url());
          if (!["GET", "HEAD"].includes(request.method())) { writes.push(request.method()); return route.abort(); }
          if (url.origin !== origin) return route.abort();
          if (url.pathname === "/api/auth/me") return route.fulfill({ json: { authenticated: false, user: null } });
          return route.continue();
        });
        await page.goto(`${origin}/${routeName}`, { waitUntil: "networkidle" });
        assert.equal(await page.locator(".dzn-beta-ticker").count(), 0, "Retired beta notice must stay absent");
        const cards = page.locator('button[aria-describedby^="mission-briefing-intel-"]');
        assert.ok(await cards.count() > 0);
        for (const card of await cards.all()) {
          await card.click();
          await page.waitForTimeout(900);
          const bounds = await card.evaluate(element => {
            const panel = element.querySelector('[data-briefing-intel]');
            const box = panel.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, viewport: innerHeight, open: element.getAttribute('aria-expanded') };
          });
          assert.equal(bounds.open, "true");
          assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.viewport, `${routeName}/${width}: expanded details scrolled outside viewport ${JSON.stringify(bounds)}`);
        }
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
        await page.screenshot({ path: path.join(output, `${routeName}-${width}.png`) });
        results.push({ route: routeName, width, errors, writes });
        await context.close();
      }
    }
    await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(`Passed ${results.length} built desktop/mobile/reduced-motion cases with fixture-only reads.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
