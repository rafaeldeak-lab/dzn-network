import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { commsHistoryFixture } from "./fixtures/comms-history";
import { COMMS_HISTORY_MAX_BYTES } from "../components/comms/comms-history-client";

async function main() {
const root = path.resolve("out");
assert.ok(existsSync(path.join(root, "community.html")), "Build with NEXT_PUBLIC_DZN_COMMS_MESSAGE_HISTORY_UI_ENABLED=true first.");
const output = path.resolve(process.env.DZN_COMMS_QA_OUTPUT ?? path.join(tmpdir(), "dzn-comms-history-client-qa"));
const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const server = createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method ?? "")) return void response.writeHead(405).end();
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname.startsWith("/api/")) return void response.writeHead(401, { "Content-Type": "application/json" }).end('{"ok":false}');
  let target: string;
  try { target = path.resolve(root, `.${decodeURIComponent(pathname)}`); } catch { return void response.writeHead(400).end(); }
  if (target !== root && !target.startsWith(root + path.sep)) return void response.writeHead(403).end();
  if (existsSync(`${target}.html`)) target += ".html";
  else if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!existsSync(target) || !statSync(target).isFile()) return void response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": mime[path.extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  if (request.method === "HEAD") return void response.end();
  createReadStream(target).on("error", () => response.destroy()).pipe(response);
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const address = server.address(); assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const results: unknown[] = [];
try {
  browser = await chromium.launch({ headless: true });
  await mkdir(output, { recursive: true });
  for (const scenario of [
    { name: "desktop", width: 1440, kind: "ready" }, { name: "tablet", width: 900, kind: "ready" },
    { name: "phone", width: 390, kind: "ready" }, { name: "small-phone", width: 320, kind: "ready" },
    { name: "empty", width: 390, kind: "empty" }, { name: "malformed", width: 390, kind: "malformed" },
    { name: "wrong-channel", width: 390, kind: "private" }, { name: "unsafe-hidden", width: 390, kind: "hidden" },
    { name: "unbroken-text", width: 320, kind: "long" }, { name: "oversize", width: 390, kind: "oversize" },
    { name: "unauthorized", width: 390, kind: "401" }, { name: "forbidden", width: 390, kind: "403" },
    { name: "offline", width: 390, kind: "offline" }, { name: "timeout", width: 390, kind: "timeout" },
    { name: "full-unicode-page", width: 390, kind: "unicode" },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage(), errors: string[] = [], prohibited: string[] = [], sockets: string[] = [];
    let reads = 0;
    page.on("pageerror", error => errors.push(error.message)); page.on("websocket", socket => sockets.push(socket.url()));
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base || !["GET", "HEAD"].includes(request.method())) { prohibited.push(url.origin + url.pathname); return route.abort(); }
      if (url.pathname !== "/api/comms/message-history") return route.continue();
      reads++;
      assert.equal(url.search, "?channel=global-chat&limit=30");
      if (scenario.kind === "offline") return route.abort();
      if (scenario.kind === "timeout") return; // Leave this local route pending until the client's own timeout aborts it.
      if (["401", "403"].includes(scenario.kind)) return route.fulfill({ status: Number(scenario.kind), contentType: "application/json", body: '{"private_error":"must not render"}' });
      const fixture = commsHistoryFixture();
      if (scenario.kind === "unicode") fixture.messages = Array.from({ length: 30 }, (_, index) => ({ ...fixture.messages[0], id: `unicode-${index}`, body: "\u4e2d".repeat(2_000) }));
      if (scenario.kind === "empty") fixture.messages = [];
      if (scenario.kind === "private") { fixture.channel.slug = "private-group"; fixture.messages[0].body = "PRIVATE-LEAK-SENTINEL"; }
      if (scenario.kind === "hidden") Object.assign(fixture.messages[0], { visibility_state: "hidden", author_display_name: "PRIVATE-AUTHOR", body: "PRIVATE-LEAK-SENTINEL" });
      if (scenario.kind === "long") { fixture.messages[0].body = "X".repeat(2_000); fixture.messages[0].author_display_name = "N".repeat(60); }
      let body = scenario.kind === "malformed" ? '{"ok":true,"read_only":true,"presentation_only":true}' : JSON.stringify(fixture);
      if (scenario.kind === "oversize") body += " ".repeat(COMMS_HISTORY_MAX_BYTES + 1);
      return route.fulfill({ status: 200, contentType: "application/json", body });
    });
    await page.goto(`${base}/community`);
    const success = ["ready", "empty", "hidden", "long", "unicode"].includes(scenario.kind);
    await page.getByText(success ? "Local/test read-history payload loaded. Sending remains disabled."
      : "Message history could not be reached, so DZN is showing the static read-only fallback.", { exact: true }).waitFor({ timeout: 9_000 });
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      disabledComposer: [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("main form input, main form button")].every(element => element.disabled),
      brokenImages: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src),
    }));
    assert.ok(metrics.scrollWidth <= metrics.width, `${scenario.name}: no horizontal page overflow`);
    assert.equal(metrics.disabledComposer, true); assert.deepEqual(metrics.brokenImages, []);
    assert.equal(reads, 1); assert.deepEqual(errors, []); assert.deepEqual(prohibited, []); assert.deepEqual(sockets, []);
    assert.doesNotMatch(await page.locator("main").innerText(), /PRIVATE-LEAK-SENTINEL|PRIVATE-AUTHOR|must not render/);
    if (scenario.kind === "empty") assert.equal(await page.locator("main article").count(), 0);
    if (scenario.kind === "hidden") assert.equal(await page.getByText("Message hidden by DZN Safety.", { exact: true }).count(), 1);
    if (scenario.kind === "unicode") assert.equal(await page.locator("main article").count(), 30);
    await page.screenshot({ path: path.join(output, `${scenario.name}.png`), fullPage: scenario.kind !== "unicode" });
    results.push({ scenario, metrics, reads, errors, prohibited, sockets });
    console.log(`PASS ${scenario.name}`);
    await context.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ localOnly: true, productionServicesUsed: false, results }, null, 2));
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
