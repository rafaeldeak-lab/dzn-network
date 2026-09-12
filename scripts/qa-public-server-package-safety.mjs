import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("out");
const output = path.resolve(process.env.DZN_SERVER_SAFETY_QA_OUTPUT ?? ".server-safety-qa");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".webm": "video/webm", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
assert.ok(existsSync(path.join(root, "servers/preview.html")), "Build first");
const summaries = Object.fromEntries(["free", "pro"].map(plan => [plan, JSON.parse(readFileSync(path.join(output, `${plan}-summary.json`), "utf8"))]));

function sampleServer(state) {
  const live = state === "live-pro";
  return {
    linked_server_id: "sample-server", public_slug: "preview", server_name: "Example community server", server_type: "PVE", tags_json: "[]", tags: [],
    status: live ? "live" : "pending", lifecycle: { status: "active_live", label: live ? "Active live" : "Setup incomplete", historical: false },
    nitrado_service_name: "Example community server", guild_name: "Example community", guild_icon_url: null,
    adm_status: live ? "Connected" : "Needs Review", stats_sync: live ? "Active" : "Not Started", stats_sync_active: live,
    player_slots: null, max_players: null, current_players: null, platform: "Xbox", map_name: "chernarus", mission: null,
    server_status: null, is_online: live, last_sync_at: null, metadata_last_checked_at: live ? "2026-09-07T00:00:00Z" : null,
    player_count_last_checked_at: null, player_count_source: null, player_count_status: null,
    public_short_description: "A public community server.", public_description: "A public community server.", public_discord_invite: null, public_website_url: null,
    public_rules: null, public_language: "English", public_region_label: "Europe", public_listing_updated_at: null, created_at: null,
    total_kills: live ? 1 : 0, total_deaths: live ? 1 : 0, total_joins: 0, total_disconnects: 0, unique_players: live ? 1 : 0, longest_kill: 45,
    kd: 1, kd_label: "1.00", rank: null, score: 0, score_label: "Pending", score_breakdown: null,
    average_rating: null, review_count: 0, rating_breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, plan_key: live ? "pro" : "free",
    badges: [], earnedBadges: [], lockedBadges: [], showcaseBadges: [], crowns: [], activePromotions: [], gallery_images: [], recent_events: [], top_players: [], pvp_leaderboard: [],
  };
}

const server = createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) return response.writeHead(405).end();
  const url = new URL(request.url, "http://localhost");
  const state = new URL(request.headers.referer ?? "http://localhost").searchParams.get("qa") ?? "pending";
  const json = payload => response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(payload));
  if (url.pathname === "/api/public/servers") return json({ ok: true, viewer_logged_in: true, server: sampleServer(state), servers: [sampleServer(state)] });
  if (url.pathname.endsWith("/leaderboards") && url.pathname.startsWith("/api/public/servers/")) return json(state === "unavailable" ? { ok: true, available: false, boards: [], summary: null } : summaries[state === "live-pro" ? "pro" : "free"]);
  if (url.pathname === "/api/auth/me") return json({ ok: true, authenticated: true, user: { id: "sample-user", username: "Example player", discord_id: "sample-discord" } });
  if (url.pathname.startsWith("/api/")) return json({ ok: true, enabled: false, reviews: [], saved_server_ids: [], saved_servers: [], notifications: [], activeEvents: [], trophies: [], currentChampionTitles: [] });
  let target;
  try { target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`); }
  catch { return response.writeHead(400).end(); }
  if (target !== root && !target.startsWith(root + path.sep)) return response.writeHead(403).end();
  if (existsSync(`${target}.html`)) target += ".html";
  else if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!existsSync(target) || !statSync(target).isFile()) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": mime[path.extname(target)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(target).pipe(response);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(process.env.DZN_SERVER_SAFETY_QA_PORT ?? 0), "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(`Local synthetic preview only: ${base}/servers/preview?qa=pending`);
} else {
  let browser;
  try {
    const modulePath = process.env.DZN_QA_PLAYWRIGHT_MODULE;
    const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : "playwright");
    browser = await chromium.launch({ headless: true });
    await mkdir(output, { recursive: true });
    const results = [];
    for (const [state, width, route] of [["pending", 1440, "/servers/preview"], ["pending", 390, "/servers/preview"], ["pending", 1024, "/servers"], ["live-pro", 1440, "/servers/preview"], ["unavailable", 390, "/servers/preview"]]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: state === "unavailable" ? "reduce" : "no-preference", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = [], prohibited = [], sockets = [], blockedBaselinePromotionAttempts = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("websocket", socket => sockets.push(socket.url()));
      await context.route("**/*", intercepted => {
        const request = intercepted.request(), url = new URL(request.url());
        // Existing discovery cards emit impressions. Block them locally; do not hide new traffic.
        if (route === "/servers" && url.origin === base && url.pathname === "/api/public/promotions/track" && request.method() === "POST") {
          blockedBaselinePromotionAttempts.push(url.pathname);
          return intercepted.abort();
        }
        if (url.origin !== base || !["GET", "HEAD"].includes(request.method()) || /analytics|tracking|telemetry|\/track\b/.test(url.pathname)) {
          prohibited.push(url.pathname);
          return intercepted.abort();
        }
        return intercepted.continue();
      });
      await page.goto(`${base}${route}?qa=${state}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(output, "latest-diagnostic.png"), fullPage: true });
      await writeFile(path.join(output, "latest-diagnostic.json"), JSON.stringify({ errors, prohibited, text: await page.locator("body").innerText() }, null, 2));
      await page.getByText("Example community server", { exact: true }).first().waitFor();
      const expected = state === "live-pro" ? "Status unavailable" : "Setup incomplete";
      await page.getByText(expected, { exact: true }).first().waitFor();
      const body = await page.locator("body").innerText();
      assert.doesNotMatch(body, /Verified Owner|DZN Verified|Network online|Online at last check|Offline at last check/);
      if (route.endsWith("preview") && state === "pending") assert.equal(await page.getByText("Pro required", { exact: true }).count(), 4);
      if (state === "live-pro") assert.equal(await page.getByText("Pro required", { exact: true }).count(), 0);
      const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).length }));
      assert.ok(metrics.scrollWidth <= width);
      assert.equal(metrics.brokenImages, 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(prohibited, []);
      assert.deepEqual(sockets, []);
      assert.equal(blockedBaselinePromotionAttempts.length, route === "/servers" ? 1 : 0);
      const name = `${state}-${width}`;
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(output, `${name}-viewport.png`) });
      if (route.endsWith("preview")) await page.locator(".dzn-advanced-showcase--server").screenshot({ path: path.join(output, `${name}-summary.png`) });
      results.push({ name, route, expected, metrics, errors, prohibited, sockets, blockedBaselinePromotionAttempts });
      console.log(`PASS ${name}`);
      await context.close();
    }
    await writeFile(path.join(output, "rendered-results.json"), JSON.stringify({ localOnly: true, syntheticData: true, results }, null, 2));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
