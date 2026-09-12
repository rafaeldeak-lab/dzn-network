import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = path.resolve("out");
const evidence = path.join(tmpdir(), "dzn-player-revocation-qa");
await mkdir(evidence, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    let file = path.resolve(root, `.${new URL(request.url, "http://localhost").pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
    if (!path.extname(file)) file += ".html";
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webm": "video/webm" };
    response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const link = { id: "link-local", user_id: "player-local", discord_id: "123456789012345678", account_name: "Example Player",
  linked_server_id: "server-local", server_name: "Example Community With A Long Server Name", owner_user_id: "owner-local",
  player_profile_id: "profile-local", player_id: "76561198" + "1".repeat(152), player_name: "Example" + "x".repeat(80),
  verified_at: "2026-09-09 12:00:00", status: "active", revoked_at: null, legacy_conflict: 0 };
const checks = [];
try {
  for (const width of [1440, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce", timezoneId: "America/Los_Angeles" });
    const page = await context.newPage();
    const errors = []; const writes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (/hydration|did not match/i.test(message.text())) errors.push(message.text()); });
    let status = 200; let legacy = false; let revoked = false; let decisionStatus = 200;
    await page.route("**/*", async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname === "/api/owner/player-game-identity-links/link-local" && request.method() === "PATCH") {
        writes.push(request.postDataJSON());
        if (decisionStatus === 200) revoked = true;
        return route.fulfill({ status: decisionStatus, json: { ok: decisionStatus === 200, message: decisionStatus === 409 ? "This link changed. Refresh before trying again." : "Link revoked." } });
      }
      assert.equal(request.method(), "GET", "Only the specifically mocked revoke action may write");
      if (url.pathname === "/api/owner/player-game-identity-links") return route.fulfill({ status,
        json: { ok: status === 200, items: revoked ? [] : [{ ...link, legacy_conflict: legacy ? 1 : 0 }], next: null } });
      if (url.pathname === "/api/owner/player-game-identity-claims") return route.fulfill({ json: { ok: true, source: "player_game_identity_claims", claims: [] } });
      return route.fulfill({ json: { ok: false, authenticated: false, user: null, notifications: [] } });
    });
    await page.goto(`${base}/owner/player-game-identity-claims`);
    const region = page.getByRole("region", { name: "Manage game stats links" });
    await region.getByRole("button", { name: "Revoke link", exact: true }).waitFor();
    const layout = async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await region.evaluate(el => el.scrollWidth <= el.clientWidth));
      assert.ok(await region.getByText(link.player_id, { exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth));
    };
    await layout();
    await region.getByRole("button", { name: "Revoke link", exact: true }).click();
    const confirm = region.getByRole("button", { name: "Confirm revocation", exact: true });
    assert.equal(await confirm.isEnabled(), false);
    await region.getByLabel("Reason shown to the player").fill("Current evidence did not match this account. Please contact support.");
    assert.equal(await confirm.isEnabled(), false);
    await region.getByRole("checkbox").check();
    assert.equal(await confirm.isEnabled(), true);
    await layout();
    await page.screenshot({ path: path.join(evidence, `confirm-${width}.png`), fullPage: true });
    decisionStatus = 409; await confirm.click();
    await region.getByRole("alert").waitFor();
    assert.equal(await confirm.isEnabled(), false, "Uncertain/stale result requires refresh before retry");
    await region.getByRole("button", { name: "Refresh game stats links" }).click();
    await region.getByRole("button", { name: "Revoke link", exact: true }).click();
    assert.equal(await region.getByLabel("Reason shown to the player").inputValue(), "");
    await region.getByLabel("Reason shown to the player").fill("Confirmed wrong account.");
    await region.getByRole("checkbox").check(); decisionStatus = 200;
    await region.getByRole("button", { name: "Confirm revocation", exact: true }).click();
    await region.getByText("No active verified links found.").waitFor();
    assert.equal(writes.length, 2); assert.equal(writes[1].confirm, true);
    revoked = false; legacy = true;
    await region.getByRole("button", { name: "Refresh game stats links" }).click();
    await region.getByText(/An older account association also exists/).waitFor();
    assert.equal(await region.getByRole("button", { name: "Revoke link", exact: true }).count(), 0);
    await layout();
    await page.screenshot({ path: path.join(evidence, `legacy-${width}.png`), fullPage: true });
    for (const failure of [401, 503]) {
      status = failure; await region.getByRole("button", { name: "Refresh game stats links" }).click();
      await region.getByRole("alert").waitFor();
      assert.equal(await region.getByText("No active verified links found.").count(), 0);
    }
    assert.deepEqual(errors, []);
    checks.push({ width, passed: true, mockedWrites: writes.length, pageErrors: errors });
    await context.close();
  }
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), mockOnly: true, checks }, null, 2));
  console.log(`Rendered revocation QA passed: ${evidence}`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
