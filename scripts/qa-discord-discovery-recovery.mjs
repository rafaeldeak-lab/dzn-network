import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = path.resolve("out");
const evidence = process.env.DZN_DISCORD_QA_OUTPUT ?? path.join(tmpdir(), "dzn-discord-discovery-qa");
await mkdir(evidence, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = path.resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
    if (!path.extname(file)) file += ".html";
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webm": "video/webm", ".png": "image/png", ".woff2": "font/woff2" })[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const sample = { id: "example-server", server_name: "Example Server", display_name: "Example Server", status: "live", guild_id: "example-guild", guild_name: "Example Community", game: "dayz", server_mode: "PVP", nitrado_service_id: "example-service", adm_status: "connected", adm_latest_file: "example.ADM", score: 123, original_owner_is_current_user: true, created_at: "2026-01-01", public_slug: "example", map_name: "chernarusplus" };
const other = { ...sample, id: "other-server", guild_id: "other-guild", server_name: "Other Server", display_name: "Other Server" };
const channel = { channel_id: "123456789012345678", channel_name: "example-channel", category_name: "Example", channel_type: "text", position: 0, category_position: 0, can_view: true, can_send: true, can_embed: true, can_read_history: true, can_manage_messages: false, can_post: true, missing_permissions: [], permission_source: "guild_role", permission_diagnostics: null };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const width of [1440, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [], writes = [], liveReads = [];
    let mode = "success";
    let releaseLive;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (req.method() !== "GET") { writes.push(url.pathname); return route.abort(); }
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { authenticated: true, user: { id: "example-owner", username: "Example Owner", discord_id: "123456789012345678" }, linkedServers: [sample, other], linkedServer: sample, navigation: { plan_tier: "pro", plan_status: "active" } } });
      if (url.pathname === "/api/dzn-pulse/config") return route.fulfill({ json: { ok: true, dznPulseEnabled: false, billingRemindersEnabled: false } });
      if (url.pathname.endsWith("/posting-destinations")) return route.fulfill({ json: { ok: true, setups: [], post_type_options: [] } });
      if (url.pathname.endsWith("/discord-channels")) {
        const id = url.pathname.split("/")[3];
        const guild = id === sample.id ? sample.guild_id : other.guild_id;
        const live = url.searchParams.get("refresh") === "1";
        const currentMode = mode;
        if (live) liveReads.push({ id, mode: currentMode });
        if (live && currentMode === "delay") await new Promise(resolve => { releaseLive = resolve; });
        if (live && currentMode === "offline") return route.abort();
        if (live && currentMode === "malformed") return route.fulfill({ json: { surprise: true } });
        const failed = live && ["missing", "forbidden", "token"].includes(currentMode);
        const error = !failed ? null : currentMode === "missing" ? "bot_not_in_guild" : currentMode === "token" ? "missing_bot_token" : "discord_api_403";
        const connected = !live ? null : failed ? (currentMode === "missing" ? false : null) : true;
        const rows = live && !failed && currentMode !== "empty" ? [channel] : [];
        const at = new Date(Date.now() + (currentMode === "future-clock" ? 30000 : currentMode === "past-clock" ? -60000 : 0)).toISOString();
        return route.fulfill({ json: { ok: !failed, selected_server_id: id, selected_guild_id: guild, guild_name: "Example Community", channels: rows, bot_connected: connected, bot_token_configured: currentMode !== "token", manual_fallback: !live || failed, fetched_at: at, error_code: error, message: failed ? "Synthetic Discord check unavailable" : undefined, diagnostics: { selected_server_id: id, selected_guild_id: guild, guild_name: "Example Community", bot_connected: connected, bot_token_configured: true, channels_fetched_count: rows.length, postable_channels_count: rows.length, last_fetch_error_code: error, last_fetch_error_message: null, last_fetch_time: at, last_fetch_attempt_at: at, last_fetch_success_at: live && !failed ? at : null, using_cached_channel_state: !live || failed } } });
      }
      return route.fulfill({ status: 503, json: { ok: false, error: "Synthetic unavailable response" } });
    });
    const bot = label => page.getByLabel(`DZN Bot Installed: ${label}`, { exact: true });
    const verify = () => page.getByRole("button", { name: "Verify Discord Connection", exact: true });
    const overview = () => page.getByRole("button", { name: /^Overview/ }).click();
    const posts = () => page.getByRole("button", { name: /^Discord Posts/ }).click();
    async function capture(name) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name);
      assert.deepEqual(errors, [], name);
      assert.deepEqual(writes, [], name);
      await page.screenshot({ path: path.join(evidence, `${name}-${width}.png`) });
      results.push({ name, width, passed: true });
    }
    await page.goto(`${base}/dashboard`);
    await bot("Not checked yet").waitFor();
    assert.equal(liveReads.length, 0, "Overview must not poll Discord.");
    await verify().scrollIntoViewIfNeeded();
    await capture("unchecked-reachable");
    await verify().click();
    await bot("Verified").waitFor();
    await page.getByLabel("Channels Discovered: 1 found", { exact: true }).waitFor();
    await capture("verified-overview");
    await posts();
    await page.getByRole("button", { name: "Recheck Channels", exact: true }).waitFor();
    assert.ok(await page.getByRole("option", { name: "#example-channel", exact: true }).count());
    await page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "#example-channel", exact: true }) }).selectOption(channel.channel_id);
    await page.getByRole("button", { name: "Recheck Channels", exact: true }).scrollIntoViewIfNeeded();
    await capture("posts-reachable");
    await page.reload();
    await overview();
    await bot("Verified").waitFor();
    await capture("verified-reload");
    for (const clock of ["future-clock", "past-clock"]) {
      mode = clock;
      await verify().click();
      await page.getByRole("button", { name: "Checking Discord...", exact: true }).waitFor({ state: "hidden" });
      await bot("Verified").waitFor();
      await page.reload();
      await bot("Verified").waitFor();
      await capture(clock);
    }
    for (const [failure, expected] of [["missing", "Not installed"], ["forbidden", "Check unavailable"], ["token", "Not configured"], ["offline", "Check unavailable"], ["malformed", "Check unavailable"]]) {
      mode = failure;
      await verify().click();
      await bot(expected).waitFor();
      assert.equal(await bot("Verified").count(), 0);
      assert.equal(await page.evaluate(() => localStorage.getItem("dzn_discord_channel_cache_example-server")), null);
      await capture(failure);
      if (failure === "missing") {
        await posts();
        assert.equal(await page.getByRole("option", { name: "#example-channel", exact: true }).count(), 0);
        assert.equal(await page.getByText("DZN Bot can post in this channel.", { exact: true }).count(), 0);
        await capture("missing-posts-cleared");
        await overview();
      }
    }
    mode = "empty";
    await verify().click();
    await bot("Verified").waitFor();
    await page.getByLabel("Channels Discovered: 0 found", { exact: true }).waitFor();
    await capture("installed-zero-channels");
    mode = "delay";
    await verify().click();
    await page.getByRole("button", { name: "Checking Discord...", exact: true }).waitFor();
    await page.getByRole("combobox", { name: "Select dashboard server", exact: true }).selectOption(other.id);
    await bot("Not checked yet").waitFor();
    assert.equal(typeof releaseLive, "function");
    releaseLive();
    await page.getByRole("heading", { name: "Other Server", exact: true }).waitFor();
    assert.equal(await bot("Verified").count(), 0);
    await capture("server-switch-in-flight");
    await context.close();
  }
  console.log(JSON.stringify({ passed: results.length, evidence }));
  await writeFile(path.join(evidence, "results.json"), JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
