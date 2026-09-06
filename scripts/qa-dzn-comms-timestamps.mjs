import assert from "node:assert/strict";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve("out");
assert.ok(existsSync(path.join(root, "community.html")), "Build the static export with the Comms UI flag off first.");
const output = path.resolve(process.env.DZN_COMMS_TIME_QA_OUTPUT ?? path.join(tmpdir(), "dzn-comms-timestamp-qa"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// Static assets and anonymous local API stubs only; no Functions runtime or database.
const server = createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) return response.writeHead(405).end();
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) return response.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end('{"ok":false}');
  let target;
  try { target = path.resolve(root, `.${decodeURIComponent(pathname)}`); }
  catch { return response.writeHead(400).end(); }
  if (target !== root && !target.startsWith(root + path.sep)) return response.writeHead(403).end();
  if (existsSync(`${target}.html`)) target += ".html";
  else if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, "index.html");
  if (!existsSync(target) || !statSync(target).isFile()) return response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": mime[path.extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  if (request.method === "HEAD") return response.end();
  createReadStream(target).on("error", () => response.destroy()).pipe(response);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(process.env.DZN_COMMS_TIME_QA_PORT ?? 0), "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(`Static, anonymous-only local preview: ${base}/community`);
} else {
  let browser;
  try {
    const modulePath = process.env.DZN_QA_PLAYWRIGHT_MODULE;
    const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : "playwright");
    browser = await chromium.launch({ headless: true });
    await mkdir(output, { recursive: true });
    const results = [];
    for (const scenario of [
      { name: "utc-desktop", timezoneId: "UTC", width: 1440, height: 1000 },
      { name: "london-desktop", timezoneId: "Europe/London", width: 1440, height: 1000 },
      { name: "new-york-mid-width", timezoneId: "America/New_York", width: 1024, height: 900 },
      { name: "kathmandu-mobile", timezoneId: "Asia/Kathmandu", width: 390, height: 844 },
      { name: "kiritimati-reduced-motion", timezoneId: "Pacific/Kiritimati", width: 390, height: 844, reducedMotion: "reduce" },
    ]) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, timezoneId: scenario.timezoneId, reducedMotion: scenario.reducedMotion ?? "no-preference", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = [], prohibited = [], commsReads = [], sockets = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("websocket", (socket) => sockets.push(socket.url()));
      await context.route("**/*", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/comms/")) commsReads.push(url.pathname);
        if (url.origin !== base || !["GET", "HEAD"].includes(request.method()) || /analytics|tracking|telemetry|beacon/i.test(url.pathname)) {
          prohibited.push({ method: request.method(), url: url.origin + url.pathname });
          return route.abort();
        }
        return route.continue();
      });
      const response = await page.goto(`${base}/community`, { waitUntil: "domcontentloaded" });
      assert.equal(response.status(), 200);
      const html = await response.text();
      const expected = ["10:12 UTC", "10:18 UTC", "10:24 UTC"];
      assert.deepEqual([...html.matchAll(/<time[^>]*>(.*?)<\/time>/g)].map((match) => match[1]), expected);
      await page.getByText("Static fallback is active. Message history is disabled by default.", { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      assert.deepEqual(await page.locator("main time").allTextContents(), expected);
      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        disabledComposer: [...document.querySelectorAll("main form input, main form button")].every((element) => element.disabled),
        brokenImages: [...document.images].filter((image) => !image.complete || !image.naturalWidth).map((image) => image.src),
        videos: [...document.querySelectorAll("video")].map((video) => ({ readyState: video.readyState, paused: video.paused, currentTime: video.currentTime, error: video.error?.code ?? null })),
      }));
      assert.ok(metrics.documentWidth <= metrics.viewportWidth);
      assert.equal(metrics.disabledComposer, true);
      assert.deepEqual(metrics.brokenImages, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(prohibited, []);
      assert.deepEqual(commsReads, []);
      assert.deepEqual(sockets, []);
      await page.screenshot({ path: path.join(output, `${scenario.name}.png`), fullPage: true });
      results.push({ scenario, status: 200, times: expected, errors, prohibited, commsReads, sockets, metrics });
      console.log(`PASS ${scenario.name}: identical server/browser times, no hydration errors or Comms requests`);
      await context.close();
    }
    await writeFile(path.join(output, "results.json"), JSON.stringify({ localOnly: true, productionServicesUsed: false, results }, null, 2));
    console.log(`Evidence: ${output}`);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
