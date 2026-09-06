import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.DZN_QA_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.DZN_QA_PLAYWRIGHT_PATH).href : "playwright");
const root = path.resolve("out");
const evidence = process.env.DZN_CLAIMS_QA_OUTPUT ?? path.join(tmpdir(), "dzn-claims-qa");
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
const exactId = "76561198" + "1".repeat(152);
const claim = {
  id: "local-claim", user_id: "sample-player", account_name: "Sample Player",
  linked_server_id: "sample-server", player_profile_id: "sample-profile", player_id: "7656...1111",
  submitted_player_id: exactId, player_name: "Sample Survivor", status: "pending",
  requested_at: "2026-09-06T12:00:00Z", server_name: "Sample Server", public_slug: "sample-server",
};
const checks = [];
try {
  for (const width of [1440, 900, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let source = "player_game_identity_claims";
    let claims = [claim];
    let status = 200;
    let deny = false;
    let patchCount = 0;
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/owner/player-game-identity-claims")) {
        if (request.method() === "PATCH") {
          patchCount++;
          assert.deepEqual(JSON.parse(request.postData()), { action: "approve", note: "" });
          if (deny) return route.fulfill({ status: 403, json: { ok: false, message: "Only this server owner can review that claim." } });
          claims = [];
          return route.fulfill({ json: { ok: true, message: "Link request approved." } });
        }
        assert.equal(request.method(), "GET");
        return route.fulfill({ status, json: { ok: true, source, private: true, owner_or_admin_only: true, claims } });
      }
      if (url.pathname.startsWith("/api/")) {
        assert.equal(request.method(), "GET", "No other API writes are allowed");
        return route.fulfill({ json: { authenticated: false, user: null, notifications: [] } });
      }
      return route.continue();
    });
    await page.goto(`${base}/owner/player-game-identity-claims`);
    await page.getByText(exactId, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal overflow");
    const fullIdVisible = await page.getByText(exactId, { exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth);
    assert.equal(fullIdVisible, true, "The full exact game ID must wrap inside its cell");
    await page.screenshot({ path: path.join(evidence, `pending-${width}.png`), fullPage: true });
    deny = true;
    await page.getByRole("button", { name: "Approve Link" }).click();
    await page.getByRole("alert").filter({ hasText: "Only this server owner" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Approve Link" }).count(), 1);
    deny = false;
    await page.getByRole("button", { name: "Approve Link" }).click();
    await page.getByRole("heading", { name: "No pending player stat checks" }).waitFor();
    assert.equal(await page.getByRole("status").filter({ hasText: "Link request approved." }).count(), 1);
    source = "unavailable";
    await page.getByRole("button", { name: "Refresh Queue" }).click();
    await page.getByRole("heading", { name: "Review queue unavailable" }).waitFor();
    assert.equal(await page.getByText("No pending player stat checks", { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(evidence, `unavailable-${width}.png`), fullPage: true });
    status = 401;
    await page.getByRole("button", { name: "Refresh Queue" }).click();
    await page.getByRole("heading", { name: "Log in to review player stat links" }).waitFor();
    assert.deepEqual(errors, []);
    assert.equal(patchCount, 2);
    checks.push({ width, passed: true, scenarios: ["pending", "full-id", "denied-review", "approval-confirmation", "empty", "unavailable", "logged-out"], pageErrors: errors });
    await context.close();
  }
  const dashboard = await readFile("out/dashboard.html", "utf8");
  const scriptPaths = [...dashboard.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
  const clientScripts = await Promise.all(scriptPaths.map(src => readFile(path.join(root, src), "utf8")));
  assert.ok(clientScripts.some(script => script.includes("/owner/player-game-identity-claims")), "Exported dashboard client must include the owner review link");
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), mockOnly: true, checks }, null, 2));
  console.log(`Claim queue rendered QA passed at 1440, 900 and 390 pixels. Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
