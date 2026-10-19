import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-hide-seek");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let previewLog = "";
preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
preview.stdout.on("data", chunk => { previewLog += chunk; }); preview.stderr.on("data", chunk => { previewLog += chunk; });

let browser;
try {
  const origin = await waitForOrigin();
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    await page.locator('button[data-game="hide-seek"]').click();
    await page.getByRole("heading", { name: "DZN Signal Hunt" }).waitFor();
    const scene = page.getByRole("group", { name: "DZN signal hunt reconnaissance scene" });
    const startButton = page.getByRole("button", { name: /^(Start hunt|New hunt)$/ });
    if (await startButton.count()) {
      await page.getByText("Run a classified sweep.").waitFor();
      await page.waitForTimeout(750);
      if (await startButton.count()) {
        await startButton.click();
        await page.getByRole("button", { name: "Hunt in progress" }).waitFor();
      }
    }
    await page.locator('img[alt*="reconnaissance"]').waitFor();
    const scannerCanvas = page.locator('canvas[data-dzn-signal-hunt-canvas="true"]');
    await scannerCanvas.waitFor({ state: "visible" });
    const scannerPixels = await scannerCanvas.evaluate(canvas => {
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) return null;
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let litPixels = 0;
      const colourBuckets = new Set();
      for (let offset = 0; offset < pixels.length; offset += 4 * 17) {
        const red = pixels[offset]; const green = pixels[offset + 1]; const blue = pixels[offset + 2]; const alpha = pixels[offset + 3];
        if (alpha > 5 && red + green + blue > 70) litPixels++;
        if (alpha > 5) colourBuckets.add(`${Math.floor(red / 24)}:${Math.floor(green / 24)}:${Math.floor(blue / 24)}`);
      }
      return { width, height, litPixels, colourBucketCount: colourBuckets.size };
    });
    assert.ok(scannerPixels && scannerPixels.width > 260 && scannerPixels.height > 170, "Signal Hunt should render a usable scanner scene.");
    assert.ok(scannerPixels.litPixels > 60, "Signal Hunt should retain visible scanner telemetry, not a blank canvas.");
    assert.ok(scannerPixels.colourBucketCount > 14, "Signal Hunt should retain meaningful scanner-scene detail.");
    assert.equal(await scene.evaluate(element => getComputedStyle(element, "::after").animationName), "none");
    assert.equal(await page.locator('[class*="hideSeekTarget"]').count(), 0, "Unrecovered target markers must not be emitted into the DOM.");
    assert.equal(await page.locator('[class*="hideSeekRecovered"]').count(), 0, "No recovered marker should exist before a server-confirmed scan.");
    await scene.focus();
    for (let press = 0; press < 10; press++) await page.keyboard.press("ArrowRight");
    await page.getByText("X 1000 / Y 0500").waitFor();
    await page.keyboard.press("Enter");
    await page.getByText("Empty sweep").waitFor();
    await page.getByText("Signal read").waitFor();
    assert.equal(await page.locator('[class*="hideSeekRecovered"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (viewport.name === "phone") {
      const sceneHeight = await scene.evaluate(element => element.getBoundingClientRect().height);
      assert.ok(sceneHeight <= 310, `Signal Hunt phone scanner should remain compact (received ${sceneHeight}px).`);
    }
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Signal Hunt desktop and phone rendered QA passed.");
} finally { await browser?.close(); preview.kill(); }

async function waitForOrigin() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = previewLog.match(/Local-only synthetic Games Hub: (http:\/\/127\.0\.0\.1:\d+)\/__local-login/);
    if (match) return match[1];
    if (preview.exitCode !== null) throw new Error(`Games preview exited before start: ${previewLog}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Games preview did not start: ${previewLog}`);
}
