import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-trivia");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let previewLog = "";
preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
preview.stdout.on("data", chunk => { previewLog += chunk; }); preview.stderr.on("data", chunk => { previewLog += chunk; });

const origin = await waitForOrigin();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    await page.locator('button[data-game="trivia"]').click();
    await page.getByRole("heading", { name: "DZN Trivia" }).waitFor();
    const start = page.getByRole("button", { name: "Start round" });
    const answers = page.locator('div[class*="triviaChoices"] button');
    await page.waitForFunction(() => document.querySelector('div[class*="triviaChoices"] button')
      || [...document.querySelectorAll("button")].some(button => button.textContent?.includes("Start round") && !button.disabled));
    if (await answers.count() === 0) {
      await page.getByLabel("Trivia difficulty").selectOption("operator");
      await start.click();
    }
    await answers.first().waitFor();
    const briefing = page.locator('div[class*="triviaQuestion"]');
    assert.match(await briefing.evaluate(element => getComputedStyle(element).backgroundImage), /trivia-command-table-v1/);
    const triviaCanvas = page.locator('canvas[data-dzn-trivia-canvas="true"]');
    await triviaCanvas.waitFor({ state: "visible" });
    const telemetry = await triviaCanvas.evaluate(canvas => {
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) return null;
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let litPixels = 0;
      const colourBuckets = new Set();
      for (let offset = 0; offset < pixels.length; offset += 4 * 19) {
        const red = pixels[offset]; const green = pixels[offset + 1]; const blue = pixels[offset + 2]; const alpha = pixels[offset + 3];
        if (alpha > 5 && red + green + blue > 70) litPixels++;
        if (alpha > 5) colourBuckets.add(`${Math.floor(red / 24)}:${Math.floor(green / 24)}:${Math.floor(blue / 24)}`);
      }
      return { width, height, litPixels, colourBucketCount: colourBuckets.size };
    });
    assert.ok(telemetry && telemetry.width > 260 && telemetry.height > 170, "Trivia should render a usable command scene.");
    assert.ok(telemetry.litPixels > 60, "Trivia command telemetry should not render a blank canvas.");
    assert.ok(telemetry.colourBucketCount > 14, "Trivia command telemetry should retain meaningful visual detail.");
    assert.equal(await answers.count(), 4);
    assert.equal(await page.getByRole("group", { name: "Field response pads" }).count(), 1);
    await page.reload({ waitUntil: "networkidle" });
    const [resumeResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/trivia") && response.request().method() === "GET"),
      page.locator('button[data-game="trivia"]').click(),
    ]);
    const resumed = await resumeResponse.json();
    await answers.first().waitFor();
    assert.ok(resumed.game?.difficulty);
    assert.equal(await page.getByLabel("Trivia difficulty").inputValue(), resumed.game.difficulty);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (viewport.name === "phone") {
      const sceneHeight = await briefing.evaluate(element => element.getBoundingClientRect().height);
      assert.ok(sceneHeight <= 560, `Trivia phone scene should remain compact (received ${sceneHeight}px).`);
    }
    const [answerResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/trivia") && response.request().method() === "POST"),
      answers.first().click(),
    ]);
    assert.equal(answerResponse.status(), 200);
    await answers.first().waitFor();
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Trivia desktop and phone rendered QA passed.");
} finally { await browser.close(); preview.kill(); }

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
