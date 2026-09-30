import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const port = Number(process.env.DZN_SERVER_PROFILE_QA_PORT ?? 3110);
const origin = `http://127.0.0.1:${port}`;
const root = path.resolve("out");
const output = path.resolve("artifacts/public-server-profile");
const html = await readFile(path.join(root, "leaderboards.html"), "utf8");
const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map((match) => `<link rel="stylesheet" href="${match[1]}">`).join("");
const players = Array.from({ length: 6 }, (_, index) => ({
  rank: index + 1,
  player_name: ["xAKA-MINI_KickAs", "Tara.W", "Nightwatch", "NorthernNomad", "ZeroHour", "LastSurvivor"][index],
  player_id: null,
  server_name: "NukeTown DEATHMATCH",
  server_slug: "nuketown-deathmatch",
  kills: 65 - index * 7,
  deaths: 22 + index * 3,
  kd: 2.95 - index * 0.31,
  kd_label: (2.95 - index * 0.31).toFixed(2),
  longest_kill: 476 - index * 31,
  last_seen: new Date().toISOString(),
  public_profile_href: index < 2 ? `/players/player-${index + 1}` : null,
  public_profile_avatar_url: index < 2 ? `/api/public/players/player-${index + 1}/avatar` : null,
}));
const serverData = {
  linked_server_id: "qa-server",
  public_slug: "nuketown-deathmatch",
  server_name: "NukeTown DEATHMATCH",
  server_type: "Deathmatch",
  tags_json: JSON.stringify(["PvP", "Fast Respawn", "Controller Friendly"]),
  status: "live",
  nitrado_service_name: "NukeTown public server",
  guild_name: "DZN Network",
  guild_icon_url: "/media/dzn-logo.png",
  adm_status: "Connected",
  stats_sync: "Active",
  player_slots: 7,
  max_players: 20,
  current_players: 7,
  platform: "Xbox",
  map_name: "ChernarusPlus",
  mission: "dayzOffline.chernarusplus",
  server_status: "started",
  is_online: true,
  last_sync_at: new Date().toISOString(),
  metadata_last_checked_at: new Date().toISOString(),
  player_count_last_checked_at: new Date().toISOString(),
  player_count_source: "nitrado",
  player_count_status: "fresh",
  public_short_description: "Fast, competitive DayZ deathmatch with verified public statistics.",
  public_description: "A focused community server with imported ADM statistics, public rankings and fair-play controls.",
  public_discord_invite: null,
  public_website_url: null,
  public_rules: "Respect other players. No exploits.",
  public_language: "English",
  public_region_label: "Europe",
  public_listing_updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  total_kills: 12691,
  total_deaths: 11042,
  total_joins: 6831,
  total_disconnects: 6620,
  unique_players: 842,
  longest_kill: 476,
  kd: 1.15,
  kd_label: "1.15",
  rank: 2,
  score: 8220,
  score_label: "8,220",
  score_breakdown: null,
  stats_sync_active: true,
  average_rating: 4.8,
  review_count: 28,
  rating_breakdown: { 1: 0, 2: 1, 3: 2, 4: 5, 5: 20 },
  advertising: { is_featured: true, featured_until: null, is_boosted: false, last_bumped_at: null, badge_label: "FEATURED" },
  plan_key: "pro",
  premium_status: "premium",
  cardStyle: "pro",
  accentColour: "#22d3ee",
  badges: [],
  showcaseBadges: [],
  recent_events: [],
  top_players: players,
  pvp_leaderboard: players,
  is_locked: false,
};
const advanced = { access: { effectivePlan: "pro", publicExplorationSummary: true, publicBuildShowcase: true, publicTravelShowcase: true }, summary: { buildScore: 0, raidScore: 0, totalDistanceM: 140200, explorationPercent: 0.02, lastUpdatedAt: new Date().toISOString() }, exploration: { supported: true, mapDisplayName: "ChernarusPlus", gridSize: 128, exploredCellsCount: 4, totalExplorableCells: 16384, explorationPercent: 0.02, overlayCells: [{ cellX: 73, cellY: 85, visits: 4 }], estimated: true }, boards: [] };
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{ServerProfile}from'./components/network/public-network';const data=${JSON.stringify(serverData)};createRoot(document.getElementById('root')).render(<main style={{maxWidth:1280,margin:'auto',padding:'0 16px'}}><ServerProfile server={data}/></main>);`;
const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const logo = await readFile(path.resolve("public/media/dzn-logo.png"));

const httpServer = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  if (url.pathname === "/") { response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`); return; }
  if (url.pathname === "/fixture.js") { response.writeHead(200, { "content-type": "text/javascript" }).end(bundle.outputFiles[0].contents); return; }
  if (url.pathname === "/api/public/players/player-1/avatar" || url.pathname === "/media/dzn-logo.png") { response.writeHead(200, { "content-type": "image/png" }).end(logo); return; }
  if (url.pathname === "/api/public/players/player-2/avatar") { response.writeHead(503).end(); return; }
  if (url.pathname === "/api/public/servers/qa-server/leaderboards") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(advanced)); return; }
  if (url.pathname === "/api/public/servers/qa-server/wars") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ activeEvents: [], trophies: [], currentChampionTitles: [] })); return; }
  const file = path.resolve(root, decodeURIComponent(url.pathname).slice(1));
  if (!file.startsWith(root + path.sep) || !(await stat(file).catch(() => null))?.isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".webp") ? "image/webp" : "application/octet-stream" }).end(await readFile(file));
});

await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(port, "127.0.0.1", resolve); });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [390, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-player-avatar="Tara.W"]')]
      .some((avatar) => avatar.getBoundingClientRect().width > 0 && !avatar.querySelector("img")));
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      height: document.documentElement.scrollHeight,
      mapWidth: document.querySelector(".dzn-exploration-mini-grid")?.getBoundingClientRect().width ?? 0,
      mapHeight: document.querySelector(".dzn-exploration-mini-grid")?.getBoundingClientRect().height ?? 0,
      visibleAvatarImages: [...document.querySelectorAll('img[alt$="Discord profile"]')].filter((image) => image.getBoundingClientRect().width > 0).length,
      brokenVisibleAvatarImages: [...document.querySelectorAll('img[alt$="Discord profile"]')].filter((image) => image.getBoundingClientRect().width > 0 && (!image.complete || image.naturalWidth === 0)).length,
      visibleFailedAvatarFallbacks: [...document.querySelectorAll('[data-player-avatar="Tara.W"]')].filter((avatar) => avatar.getBoundingClientRect().width > 0 && avatar.textContent.trim().length > 0 && !avatar.querySelector("img")).length,
      markerTop: Number.parseFloat(document.querySelector(".dzn-exploration-mini-grid > span")?.style.top ?? "NaN"),
    }));
    assert.equal(metrics.overflow, false, `Profile must not overflow at ${width}px`);
    assert.ok(Math.abs(metrics.mapHeight - metrics.mapWidth) <= 2, `Map should preserve its square geometry at ${width}px`);
    assert.ok(metrics.mapWidth <= 416, `Map should remain compact at ${width}px`);
    assert.ok(metrics.visibleAvatarImages >= 1, "A working consented Discord profile avatar should remain visible");
    assert.equal(metrics.brokenVisibleAvatarImages, 0, "Failed avatar requests should not leave visible broken images");
    assert.ok(metrics.visibleFailedAvatarFallbacks >= 1, "A failed avatar request should visibly fall back to player initials");
    assert.ok(Math.abs(metrics.markerTop - ((128 - 85 - 0.5) / 128 * 100)) < 0.01, "Map markers should invert world Y for the north-up map artwork");
    const disclosure = page.locator(".dzn-profile-mobile-disclosure").first();
    if (width === 390) {
      assert.equal(await disclosure.locator(".dzn-profile-mobile-disclosure__content").isVisible(), false, "Secondary mobile sections should start collapsed");
      const disclosureButton = disclosure.locator(".dzn-profile-mobile-disclosure__button");
      assert.equal((await disclosureButton.innerText()).trim().toLowerCase(), "server wars history");
      assert.equal(await disclosureButton.getAttribute("aria-expanded"), "false");
      await disclosureButton.press("Enter");
      assert.equal(await disclosureButton.getAttribute("aria-expanded"), "true");
      assert.equal(await disclosure.locator(".dzn-profile-mobile-disclosure__content").isVisible(), true, "Secondary mobile sections should expand on demand");
    } else {
      assert.equal(await disclosure.locator(".dzn-profile-mobile-disclosure__content").isVisible(), true, "Secondary sections should remain visible on larger screens");
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `profile-${width}.png`), fullPage: true });
    results.push({ width, ...metrics });
    await context.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log("Public server profile QA passed at phone, tablet and desktop widths.");
} finally {
  await browser.close();
  await new Promise((resolve) => httpServer.close(resolve));
}
