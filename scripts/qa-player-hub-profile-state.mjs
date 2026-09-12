import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.env.DZN_PROFILE_QA_BUILD_ROOT ?? "out");
const output = path.resolve(process.env.DZN_PROFILE_QA_OUTPUT ?? "artifacts/player-hub-profile-state-qa");
const port = Number(process.env.DZN_PROFILE_QA_PORT ?? 3102);
const origin = `http://127.0.0.1:${port}`;
const name = "Profile QA Player";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/x-component", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4", ".ico": "image/x-icon" };
const messages = {
  published: "Your public profile shows only the sections you have chosen to share.",
  private: "Your public profile is switched off.",
  not_published: "Your profile is not published yet. Check your profile settings to finish.",
  unavailable: "We could not check your public profile right now. Your saved settings have not changed.",
};
function hub(publicState, statsState) {
  const hasStats = statsState === "stats_available" || statsState === "zero";
  return {
    ok: true, generated_at: "2026-09-09T06:00:00Z", account: { display_name: name, avatar: null, player_home_href: "/player", private_profile_href: "/player/profile" },
    saved_servers: [], saved_server_ids: [], matched_communities: [], suggested_events: [], profile_entries: [],
    discord_membership_status: { source: "player_discord_community_memberships", last_checked_at: null, refresh_href: "/api/player/community-memberships/refresh", refresh_method: "POST", private: true, presentation_only: true, message: "No communities matched yet." },
    suggested_event_relevance: { private: true, presentation_only: true, uses_followed_servers: false, uses_matched_communities: false, message: "No event suggestions yet." },
    profile_summary: { display_name: name, public_profile_status: publicState, public_profile_href: publicState === "published" ? "/players/profile-qa-player" : null, private_profile_href: "/player/profile", public_profile_message: messages[publicState], linked_game_profiles: statsState === "unavailable" ? null : hasStats ? 1 : 0, linked_public_servers: statsState === "unavailable" ? null : hasStats ? 1 : 0, source: "player_profiles", private: true, presentation_only: true },
    progression_summary: { status: hasStats ? "stats_available" : statsState, source: "player_profiles", gameplay_totals: { kills: hasStats ? statsState === "zero" ? 0 : 25 : null, deaths: hasStats ? 0 : null, suicides: hasStats ? 0 : null, longest_kill_distance: hasStats ? statsState === "zero" ? 0 : 106.7 : null }, featured_server: null,
      tracks: ["XP", "Challenges", "Calling cards"].map(label => ({ key: label.toLowerCase().replace(" ", "_"), label, status: "future_earned_runtime", description: `${label} is not available yet.` })),
      message: hasStats ? "Your linked stats from public servers. Only the sections you choose to share appear on your public profile." : statsState === "empty" ? "No linked server stats yet. Check your game account link. Once approved, stats appear here after your server imports activity." : "Your server stats are temporarily unavailable. Please try again later.", private: true, presentation_only: true },
    owner_setup: { href: "/pricing?intent=owner_setup&returnTo=%2Fsetup", gated: true, requires_entitlement: true, label: "Owner pricing", description: "Owner pricing" },
    sources: { saved_servers: "player_saved_servers", matched_communities: "player_discord_community_memberships", suggested_events: "public_competitive_events", profile_progression: "player_profiles" }, fairness_boundary: [],
  };
}
function privacy(enabled) {
  return { ok: true, settings: { public_profile_enabled: enabled }, sections: [{ key: "public_profile_enabled", label: "Public profile", description: "Share the sections you choose.", default_value: false, enabled }], public_profile_status: enabled ? "published" : "private_by_default", public_profile_handle: enabled ? "profile-qa-player" : null, public_profile_href: enabled ? "/players/profile-qa-player" : null, source: "player_profile_privacy_preferences", updated_at: null, private: true, presentation_only: true, message: "Fixture privacy settings", fairness_boundary: [] };
}
function api(pathname, publicState = "published", statsState = "stats_available") {
  if (pathname === "/api/auth/me") return { authenticated: true, user: { id: "profile-qa", username: name, avatar: null }, linkedServers: [], linkedServer: null };
  if (pathname === "/api/player/hub") return hub(publicState, statsState);
  if (pathname === "/api/player/profile/privacy") return privacy(publicState === "published");
  if (pathname === "/api/player/game-identities") return { ok: true, source: "player_game_identity_links", active_links: [], claims: [], revoked_links: [{ id: "revoked-fixture", player_name: "Example Game Account", server_name: "Example Server", revoked_at: "2026-09-09 12:00:00", reason: "The proof did not match this game account. Contact support to submit current evidence." }], proof_flow: { player_step: "Choose your server.", owner_step: "Request approval.", match_rule: "A server owner checks the link." }, boundary: "Fixture game account data" };
  if (pathname === "/api/public/servers") return { ok: true, servers: [] };
  if (pathname === "/api/public/players/profile-qa-player") return { ok: true, handle: "profile-qa-player", href: "/players/profile-qa-player", display_name: name, published_at: null, updated_at: null,
    sections: { display_name: { visible: true, value: name }, gameplay_summary: { visible: true, totals: { kills: 25, deaths: 0, suicides: 0, longest_kill_distance: 106.7, linked_public_servers: 1 }, last_seen_at: null }, featured_server: { visible: false, server: null },
      ...Object.fromEntries(["xp_progress", "challenge_progress", "calling_cards", "award_dates"].map(key => [key, { visible: false, status: "hidden", message: "Not available yet" }])) }, privacy: { public_profile_enabled: true, visible_sections: ["display_name", "gameplay_summary"] }, fairness_boundary: [] };
  if (pathname === "/api/dzn-pulse/config") return { ok: true, config: { enabled: false, billingRemindersEnabled: false, billingTrialRemindersEnabled: false } };
  if (pathname === "/api/dzn-pulse/notifications/unread-count") return { ok: true, unread_count: 0 };
  return null;
}

// A loopback-only built preview; all account responses are synthetic and no mutation is accepted.
const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
    if (pathname.startsWith("/api/")) {
      const payload = api(pathname);
      response.writeHead(payload ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(payload ?? { ok: false })); return;
    }
    const relative = pathname === "/" ? "index.html" : pathname === "/players/profile-qa-player" ? "players.html" : pathname.replace(/^\/players\/profile-qa-player\//, "/players/").slice(1);
    const candidate = path.resolve(root, relative);
    if (!candidate.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    let file;
    // Windows exports segment-prefetch assets as nested files; serve the actual built bytes.
    const segmentCandidate = candidate.replace(/(__next\.[^./\\]+)((?:\.[^/\\]+)+)\.txt$/, (_, prefix, segments) => `${prefix}${segments.replaceAll(".", path.sep)}.txt`);
    for (const entry of [candidate, segmentCandidate, `${candidate}.html`, path.join(candidate, "index.html")]) {
      if ((await stat(entry).catch(() => null))?.isFile()) { file = entry; break; }
    }
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  } catch { response.writeHead(500).end(); }
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
if (process.argv.includes("--serve")) {
  console.log(`Synthetic Player Hub preview: ${origin}/player#profile-summary`);
} else {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    if (process.argv.includes("--followup-only")) results.push(...await checkProfileFollowups(browser));
    for (const width of process.argv.includes("--followup-only") ? [] : [1440, 900, 390, 320]) {
      for (const [publicState, statsState] of [["published", "stats_available"], ["private", "zero"], ["private", "empty"], ["not_published", "empty"], ["unavailable", "stats_available"], ["published", "unavailable"]]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: width < 400 ? "reduce" : "no-preference", timezoneId: "America/Los_Angeles" });
        const page = await context.newPage();
        const errors = [], failures = [], mutations = [];
        let currentState = publicState, hubReads = 0, rejectSave = false;
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        page.on("response", response => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
        await page.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== origin) { await route.abort(); return; }
          if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
          if (request.method() !== "GET") {
            mutations.push(`${request.method()} ${url.pathname}`);
            assert.equal(url.pathname, "/api/player/profile/privacy");
            assert.equal(request.method(), "PATCH");
            if (rejectSave) { await route.fulfill({ status: 503, json: { ok: false, message: "Fixture save failure" } }); return; }
            currentState = request.postDataJSON().settings.public_profile_enabled ? "published" : "private";
          }
          if (url.pathname === "/api/player/hub") hubReads++;
          const payload = api(url.pathname, currentState, statsState);
          if (!payload) errors.push(`Unexpected API request: ${url.pathname}`);
          await route.fulfill({ status: payload ? 200 : 404, json: payload ?? { ok: false } });
        });
        for (const routePath of ["/player", "/player/profile"]) {
          await page.goto(`${origin}${routePath}#profile-summary`, { waitUntil: "networkidle" });
          const panel = page.locator("#profile-summary");
          await panel.getByRole("heading", { name: "My Server Stats" }).waitFor();
          assert.match(await panel.innerText(), new RegExp(messages[publicState].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          assert.equal(await panel.getByRole("link", { name: "View public profile", exact: true }).count(), publicState === "published" ? 1 : 0);
          const metrics = await panel.getByLabel("Server statistics").innerText();
          assert.equal((metrics.match(/--/g) ?? []).length, ["empty", "unavailable"].includes(statsState) ? 4 : 0);
          if (statsState === "zero") assert.match(metrics, /0m/);
          assert.doesNotMatch(await panel.innerText(), /future earned runtime|profile privacy slices|Current Profile Signals|NOT CONFIGURED/i);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page overflow at ${width}`);
          assert.deepEqual(mutations, [], "Reading the hub must not mutate anything");
          if (routePath === "/player/profile") {
            const revoked = page.getByRole("region", { name: "Revoked game stats links" });
            await revoked.getByText("The proof did not match this game account. Contact support to submit current evidence.").waitFor();
            assert.equal(await revoked.getByRole("link", { name: "Contact support" }).getAttribute("href"), "mailto:dznnetworksupport@gmail.com");
            assert.ok(await revoked.evaluate(el => el.scrollWidth <= el.clientWidth));
            for (const [label, id] of [["Edit profile", "profile-settings"], ["Game account", "game-account"]]) {
              await panel.getByRole("link", { name: label, exact: true }).click();
              await page.waitForFunction(expected => location.hash === `#${expected}` && document.getElementById(expected)?.getBoundingClientRect().top < innerHeight, id);
            }
          }
          if (routePath === "/player") await panel.screenshot({ path: path.join(output, `${publicState}-${statsState}-${width}.png`) });
        }
        if (publicState === "published" && statsState === "stats_available") {
          const initialReads = hubReads;
          await page.getByRole("button", { name: "Hide Public profile on public profile surfaces", exact: true }).click();
          await page.waitForFunction(() => document.querySelector("#profile-summary")?.textContent.includes("Your public profile is switched off."));
          assert.ok(hubReads > initialReads, "Saving must reread the summary");
          assert.equal(await page.locator("#profile-summary").getByRole("link", { name: "View public profile", exact: true }).count(), 0);
          rejectSave = true;
          await page.getByRole("button", { name: "Show Public profile on public profile surfaces", exact: true }).click();
          await page.getByText("Fixture save failure", { exact: true }).first().waitFor();
          assert.equal(await page.locator("#profile-summary").getByRole("link", { name: "View public profile", exact: true }).count(), 0, "Failed publication must not invent a link");
          assert.deepEqual(mutations, ["PATCH /api/player/profile/privacy", "PATCH /api/player/profile/privacy"]);
        }
        assert.ok(failures.every(value => value === "503 /api/player/profile/privacy"), JSON.stringify(failures));
        assert.ok(errors.every(value => /503 \(Service Unavailable\)/.test(value)), JSON.stringify(errors));
        results.push({ width, publicState, statsState, routes: 2, overflow: false, mutations, expectedSaveFailure: rejectSave, pageErrors: errors });
        await context.close();
      }
    }
    await writeFile(path.join(output, "results.json"), JSON.stringify({ synthetic: true, productionActions: false, checkedAt: new Date().toISOString(), results }, null, 2));
    console.log(`Passed ${results.length} built scenarios (${process.argv.includes("--followup-only") ? "profile empty states and delayed navigation" : "two routes per scenario, privacy-save refresh and failure handling"}).`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

async function checkProfileFollowups(browser) {
  const results = [];
  for (const width of [1440, 900, 390, 320]) {
    for (const scenario of process.argv.includes("--navigation-only") ? ["empty"] : ["empty", "zero", "populated", "hidden", "unavailable"]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: width < 400 ? "reduce" : "no-preference" });
      const page = await context.newPage();
      const errors = [], mutations = [];
      let holdIdentity = false;
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { await route.abort(); return; }
        if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
        if (request.method() !== "GET") { mutations.push(`${request.method()} ${url.pathname}`); await route.fulfill({ status: 405, json: { ok: false } }); return; }
        // Deliberately let native navigation run before authentication and panel data arrive.
        const delay = { "/api/auth/me": 350, "/api/player/hub": 750, "/api/player/game-identities": holdIdentity ? 4000 : 1100, "/api/player/profile/privacy": 500 }[url.pathname] ?? 0;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const payload = api(url.pathname, "published", scenario === "populated" ? "stats_available" : scenario);
        if (url.pathname === "/api/public/players/profile-qa-player" && payload) {
          const summary = payload.sections.gameplay_summary;
          summary.visible = scenario !== "hidden";
          if (scenario === "unavailable") summary.totals = null;
          else if (scenario !== "populated" && scenario !== "hidden") {
            summary.totals = { kills: 0, deaths: 0, suicides: 0, longest_kill_distance: 0, linked_public_servers: scenario === "zero" ? 1 : 0 };
          }
        }
        if (!payload) errors.push(`Unexpected API request: ${url.pathname}`);
        await route.fulfill({ status: payload ? 200 : 404, json: payload ?? { ok: false } });
      });
      try {
        await page.goto(`${origin}/players/profile-qa-player`, { waitUntil: "networkidle" });
        const metrics = page.getByText("Public Servers", { exact: true }).locator("xpath=ancestor::section[1]");
        await metrics.waitFor();
        const publicText = await metrics.innerText();
        if (["empty", "unavailable"].includes(scenario)) assert.equal((publicText.match(/--/g) ?? []).length, 4);
        if (scenario === "hidden") { assert.equal((publicText.match(/Hidden/g) ?? []).length, 4); assert.doesNotMatch(publicText, /25|107m/); }
        if (scenario === "zero") { assert.doesNotMatch(publicText, /--|Hidden/); assert.match(publicText, /0m/); }
        if (scenario === "populated") { assert.match(publicText, /25/); assert.match(publicText, /107m/); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await metrics.screenshot({ path: path.join(output, `public-${scenario}-${width}.png`) });

        await page.goto(`${origin}/player/profile#profile-settings`, { waitUntil: "networkidle" });
        const preview = page.getByLabel("Visitor preview statistics", { exact: true });
        await preview.waitFor();
        const previewText = await preview.innerText();
        if (["empty", "unavailable"].includes(scenario)) assert.equal((previewText.match(/--/g) ?? []).length, 3);
        if (scenario === "hidden") assert.equal((previewText.match(/Hidden/g) ?? []).length, 3);
        if (scenario === "zero") { assert.doesNotMatch(previewText, /--|Hidden/); assert.match(previewText, /0m/); }
        if (scenario === "populated") { assert.match(previewText, /25/); assert.match(previewText, /107m/); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await preview.screenshot({ path: path.join(output, `preview-${scenario}-${width}.png`) });

        if (scenario === "empty") {
          await page.goto(`${origin}/player#profile-summary`, { waitUntil: "networkidle" });
          for (const [name, id] of [["Game account", "game-account"], ["Edit profile", "profile-settings"]]) {
            if (id === "profile-settings") await page.goto(`${origin}/player#profile-summary`, { waitUntil: "networkidle" });
            await page.locator("#profile-summary").getByRole("link", { name, exact: true }).click();
            await page.waitForLoadState("networkidle");
            await assertAnchorInView(page, id);
            await page.screenshot({ path: path.join(output, `first-navigation-${id}-${width}.png`) });
            await page.reload({ waitUntil: "networkidle" });
            await assertAnchorInView(page, id);
          }
          await page.goto(`${origin}/player/profile`, { waitUntil: "networkidle" });
          assert.equal(await page.evaluate(() => scrollY), 0, "No fragment must not trigger an unsolicited scroll");
          await page.goto(`${origin}/player/profile#unknown-section`, { waitUntil: "networkidle" });
          assert.equal(await page.evaluate(() => scrollY), 0, "Unknown fragments must not trigger a fallback scroll");
          await page.goto(`${origin}/player`, { waitUntil: "networkidle" });
          holdIdentity = true;
          await page.goto(`${origin}/player/profile#profile-settings`, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => document.querySelector("#profile-summary")?.textContent.includes("No linked server stats yet."));
          assert.equal(await page.locator('#game-account [aria-busy="true"]').count(), 1);
          await page.keyboard.press("Control+Home");
          await page.waitForLoadState("networkidle");
          assert.equal(await page.evaluate(() => scrollY), 0, "A late panel response must not override the user's scroll");
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(mutations, []);
        results.push({ width, scenario, publicAndPreview: true, delayedNavigation: scenario === "empty", errors, mutations });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `failure-${scenario}-${width}.png`) }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
  }
  return results;
}

async function assertAnchorInView(page, id) {
  await page.waitForFunction(expected => {
    const top = document.getElementById(expected)?.getBoundingClientRect().top;
    return location.hash === `#${expected}` && top >= 90 && top < innerHeight / 2;
  }, id, { timeout: 5000 });
}
