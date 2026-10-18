import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const output = path.resolve("artifacts/games-relay-rush");
await mkdir(output, { recursive: true });
function startPreview() {
  const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
  });
  let previewLog = "";
  preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
  preview.stdout.on("data", chunk => { previewLog += chunk; });
  preview.stderr.on("data", chunk => { previewLog += chunk; });
  return { preview, readLog: () => previewLog };
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [
    { name: "desktop-delayed-link", width: 1440, height: 1000, requestDelay: 360, exercisePulse: true },
    { name: "desktop-latency-downshift", width: 1440, height: 1000, initialStartDelay: 360, exercisePulse: true },
    { name: "phone", width: 390, height: 844, exercisePulse: true },
    { name: "renderer-unavailable", width: 1440, height: 1000, forceNoWebGl: true },
  ]) {
    const { preview, readLog } = startPreview();
    let context;
    try {
      const origin = await waitForOrigin(preview, readLog);
      context = await browser.newContext({ viewport, reducedMotion: "reduce" });
      if (viewport.forceNoWebGl) {
        await context.addInitScript(() => {
          Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
        });
      }
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      if (viewport.requestDelay || viewport.initialStartDelay) {
        let initialStartDelayed = false;
        await page.route("**/api/games/relay-rush", async route => {
          const request = route.request();
          const isInitialStart = request.method() === "POST" && request.postData()?.includes('"action":"start"') && !initialStartDelayed;
          const delay = viewport.requestDelay ?? (isInitialStart ? viewport.initialStartDelay : 0);
          if (isInitialStart) initialStartDelayed = true;
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          await route.continue();
        });
      }
      await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
      if (viewport.forceNoWebGl) {
        assert.equal(await page.evaluate(() => document.createElement("canvas").getContext("webgl")), null,
          "Renderer-failure QA must block WebGL context construction.");
      }
      const [loadResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "GET"),
        page.locator('[data-game="relay-rush"]').click(),
      ]);
      assert.equal(loadResponse.status(), 200, await loadResponse.text());
      await page.getByRole("heading", { name: "DZN Relay Rush" }).waitFor();
      if (viewport.forceNoWebGl) {
        const startRun = page.getByRole("button", { name: "Start run" });
        const [startResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "POST"),
          startRun.click(),
        ]);
        assert.equal(startResponse.status(), 200, await startResponse.text());
        const relayPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "DZN Relay Rush" }) });
        await page.waitForTimeout(300);
        const rendererStates = await relayPanel.locator("[data-renderer]").evaluateAll(elements => elements.map(element => element.getAttribute("data-renderer")));
        assert.deepEqual(rendererStates, ["fallback"], `Renderer-failure QA must enter the visible fallback state (received ${JSON.stringify(rendererStates)}; panel ${JSON.stringify((await relayPanel.innerText()).slice(0, 420))}).`);
        const chamber = relayPanel.locator('[data-renderer="fallback"]');
        assert.equal(await chamber.locator('canvas[data-dzn-relay-rush-canvas="true"]').count(), 0, "Renderer fallback must not retain an unusable WebGL canvas.");
        assert.match(await chamber.evaluate(element => getComputedStyle(element).backgroundImage), /relay-rush-chamber-v2/,
          "Relay Rush renderer fallback must retain the chamber artwork.");
        const fallbackImage = await sharp(await chamber.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let visiblePixels = 0;
        for (let offset = 0; offset < fallbackImage.data.length; offset += fallbackImage.info.channels * 19) {
          const red = fallbackImage.data[offset]; const green = fallbackImage.data[offset + 1]; const blue = fallbackImage.data[offset + 2];
          if (red + green + blue > 75) visiblePixels++;
        }
        assert.ok(visiblePixels > 100, "Relay Rush renderer fallback must remain visibly rendered, not blank.");
      }
      if (viewport.exercisePulse) {
        const startRun = page.getByRole("button", { name: "Start run" });
        for (let attempt = 0; attempt < 20 && !(await startRun.isEnabled()); attempt++) await page.waitForTimeout(50);
        assert.equal(await startRun.isEnabled(), true, "Relay Rush must become startable after a delayed state response settles.");
        const [startResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "POST"),
          startRun.click(),
        ]);
        const started = await startResponse.json();
        assert.equal(startResponse.status(), 200, JSON.stringify(started));
        const relayPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "DZN Relay Rush" }) });
        const relayStage = relayPanel.locator('div[data-status][data-intensity]');
        const chamberCanvas = relayPanel.locator('canvas[data-dzn-relay-rush-canvas="true"]');
        await chamberCanvas.waitFor({ state: "visible" });
        const chamberImage = await sharp(await chamberCanvas.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let litPixels = 0;
        const sampledColours = new Set();
        for (let offset = 0; offset < chamberImage.data.length; offset += chamberImage.info.channels * 17) {
          const red = chamberImage.data[offset]; const green = chamberImage.data[offset + 1]; const blue = chamberImage.data[offset + 2];
          if (red + green + blue > 80) litPixels++;
          sampledColours.add(`${Math.floor(red / 24)}:${Math.floor(green / 24)}:${Math.floor(blue / 24)}`);
        }
        assert.ok(chamberImage.info.width > 250 && chamberImage.info.height > 180, "Relay Rush should render a usable relay chamber scene");
        assert.ok(litPixels > 80, "Relay Rush should retain visible relay lighting, not a black canvas");
        assert.ok(sampledColours.size > 18, "Relay Rush should retain meaningful rendered scene detail");
        if (viewport.name === "phone") {
          const chamberHeight = await relayPanel.locator('[class*="relayRushChamber"]').evaluate(element => element.getBoundingClientRect().height);
          assert.ok(chamberHeight <= 390, `Relay Rush mobile relay chamber should stay compact (received ${chamberHeight}px)`);
        }
        await relayStage.evaluate(element => element.setAttribute("data-intensity", "storm"));
        assert.match(await relayStage.evaluate(element => getComputedStyle(element).backgroundImage), /relay-rush-chamber-v2/,
          "Relay Rush storm phase must retain the chamber artwork.");
        await relayStage.evaluate((element, intensity) => element.setAttribute("data-intensity", intensity), started.game.intensity);
        const liveLane = relayPanel.locator('button[data-target="true"]');
        await liveLane.waitFor();
        const observedOpenAt = await page.evaluate(() => Date.now());
        assert.ok(observedOpenAt >= started.game.nextAt, `Relay Rush lane opened before DZN: ${JSON.stringify({ observedOpenAt, serverTime: started.serverTime, nextAt: started.game.nextAt })}`);
        // The real client cannot produce a zero-millisecond keypress. Keep a
        // small reaction margin so the test detects the old 360 ms early lane
        // without racing React's 50 ms display-clock interval at the boundary.
        if (viewport.initialStartDelay) await page.waitForTimeout(120);
        const lane = await liveLane.getAttribute("data-lane");
        const key = lane === "left" ? "KeyA" : lane === "centre" ? "KeyS" : "KeyD";
        const [pulseResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "POST"),
          page.keyboard.press(key),
        ]);
        assert.equal(pulseResponse.status(), 200, await pulseResponse.text());
        await page.getByText("1 / 12 pulses", { exact: true }).waitFor();
        assert.equal(await relayPanel.getByRole("group", { name: "Relay Rush signal lanes" }).locator('button[disabled]').count(), 3);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
      const unexpectedErrors = errors.filter(error => !(viewport.forceNoWebGl && error.includes("THREE.WebGLRenderer: Error creating WebGL context.")));
      assert.deepEqual(unexpectedErrors, []);
    } finally {
      await context?.close();
      preview.kill();
    }
  }
  console.log("DZN Relay Rush desktop, phone, sustained-delay and latency-downshift rendered QA passed.");
} finally {
  await browser?.close();
}

async function waitForOrigin(preview, readLog) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = readLog().match(/Local-only synthetic Games Hub: (http:\/\/127\.0\.0\.1:\d+)\/__local-login/);
    if (match) return match[1];
    if (preview.exitCode !== null) throw new Error(`Games preview exited before start: ${readLog()}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Games preview did not start: ${readLog()}`);
}
