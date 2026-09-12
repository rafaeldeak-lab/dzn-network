import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const root = path.resolve("out");
const evidence = process.env.DZN_SUPPORT_QA_OUTPUT ?? path.join(tmpdir(), "dzn-player-support-qa");
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
  id: "claim-local-001", user_id: "player-local", discord_id: "123456789012345678", account_name: "Example Player",
  linked_server_id: "local-server", server_name: "A Long Community Server Name For Responsive Checks", server_status: "active_live",
  owner_user_id: "owner-local", owner_name: "Example Owner", guild_id: "223456789012345678", player_profile_id: "profile-local",
  player_id: exactId, player_name: "Survivor" + "X".repeat(70), status: "pending", requested_at: "2026-09-09 12:00:00",
  reviewed_at: null, reviewer_id: null, reviewer_name: null, review_note: null, imported_profile_present: 1, active_link_id: null,
};
const event = { id: "event-local", action: "claim_requested", result: "accepted", actor_user_id: "player-local",
  actor_name: "Example Player", note: "Pending exact game ID claim created for owner/admin review.", link_id: null, created_at: claim.requested_at };
const checks = [];
try {
  for (const width of [1440, 900, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce", timezoneId: "America/Los_Angeles" });
    const page = await context.newPage();
    const errors = [];
    const queries = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (/hydration|did not match/i.test(message.text())) errors.push(message.text()); });
    let responseStatus = 200;
    let empty = false;
    let reads = 0;
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        assert.equal(request.method(), "GET", "QA must never issue application writes");
        if (url.pathname === "/api/owner/player-requests") {
          reads++; queries.push(url.search);
          const detail = url.searchParams.has("request");
          const older = url.searchParams.has("cursor");
          return route.fulfill({ status: responseStatus, json: responseStatus !== 200 ? { ok: false } : detail
            ? { ok: true, request: claim, history: [{ ...event, id: older ? "event-older" : event.id, note: older ? "Older recorded event" : event.note }], nextCursor: older ? null : "older-events" }
            : { ok: true, items: empty ? [] : [{ ...claim, id: older ? "claim-older" : claim.id }], nextCursor: older || empty ? null : "older-requests" } });
        }
        return route.fulfill({ json: { ok: false, authenticated: false, user: null, notifications: [] } });
      }
      return route.continue();
    });
    const support = page.getByRole("region", { name: "Player request support" });
    await page.goto(`${base}/owner?view=player-requests`);
    await support.getByRole("button", { name: `Open request ${claim.id}` }).waitFor();
    const layout = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No document overflow");
      assert.equal(await support.evaluate(el => el.scrollWidth <= el.clientWidth), true, "No support panel overflow");
      assert.ok((await support.boundingBox()).height >= 200, "Mobile navigation must leave usable content space");
    };
    await layout();
    await page.screenshot({ path: path.join(evidence, `list-${width}.png`), fullPage: true });
    await support.getByRole("searchbox").fill("Example Player");
    await support.getByLabel("Status", { exact: true }).selectOption("pending");
    const beforeSearch = reads;
    await support.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForFunction(() => location.search.includes("q=Example+Player") && location.search.includes("status=pending"));
    await support.getByRole("button", { name: `Open request ${claim.id}` }).waitFor();
    assert.ok(reads > beforeSearch);
    assert.ok(queries.some(query => query.includes("status=pending") && query.includes("q=Example+Player")));
    await support.getByRole("button", { name: "Older requests" }).click();
    await support.getByRole("button", { name: "Open request claim-older" }).waitFor();
    await page.goBack();
    await support.getByRole("button", { name: `Open request ${claim.id}` }).click();
    await support.getByRole("heading", { name: "Recorded history" }).waitFor();
    await layout();
    assert.ok(await support.getByText(exactId, { exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth));
    assert.ok((await support.innerText()).includes("9 Sept 2026, 12:00 UTC"));
    await page.screenshot({ path: path.join(evidence, `detail-${width}.png`), fullPage: true });
    await support.getByRole("button", { name: "Older events" }).click();
    await support.getByText("Older recorded event", { exact: true }).waitFor();
    await page.reload();
    await support.getByText("Older recorded event", { exact: true }).waitFor();
    await support.getByRole("button", { name: "Back to requests" }).click();
    await support.getByRole("button", { name: `Open request ${claim.id}` }).waitFor();
    assert.equal(await support.getByRole("searchbox").inputValue(), "Example Player");
    empty = true;
    await support.getByRole("button", { name: "Refresh requests" }).click();
    await support.getByText("No requests match these filters.").waitFor();
    for (const status of [401, 403, 503]) {
      responseStatus = status;
      await support.getByRole("button", { name: "Refresh requests" }).click();
      await support.getByRole("alert").waitFor();
      assert.equal(await support.getByText("No requests match these filters.").count(), 0, "Errors are not empty results");
      await layout();
    }
    await page.screenshot({ path: path.join(evidence, `unavailable-${width}.png`), fullPage: true });
    responseStatus = 200; empty = false;
    await support.getByRole("button", { name: "Clear filters and retry" }).click();
    await support.getByRole("button", { name: `Open request ${claim.id}` }).waitFor();
    assert.deepEqual(errors, []);
    checks.push({ width, passed: true, reads, pageErrors: errors, scenarios: ["list", "search", "status", "pagination", "detail", "exact-id-wrap", "UTC", "history", "reload", "back", "empty", "401", "403", "503", "retry"] });
    await context.close();
  }
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), mockOnly: true, checks }, null, 2));
  console.log(`Player request support rendered QA passed. Evidence: ${evidence}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
