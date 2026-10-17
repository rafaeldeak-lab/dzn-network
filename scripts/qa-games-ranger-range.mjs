import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-ranger-range");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
});
let previewLog = "";
preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
preview.stdout.on("data", chunk => { previewLog += chunk; });
preview.stderr.on("data", chunk => { previewLog += chunk; });

let browser;
try {
  const origin = await waitForOrigin();
  browser = await chromium.launch({ headless: true });
  for (const [index, viewport] of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "phone", width: 390, height: 844 },
  ].entries()) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    const [loadResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/ranger-range") && response.request().method() === "GET"),
      page.getByRole("button", { name: /Ranger Range/ }).click(),
    ]);
    assert.equal(loadResponse.status(), 200, await loadResponse.text());
    await page.getByRole("heading", { name: "DZN Ranger Range" }).waitFor();
    const mountainOutpost = await page.locator('[aria-labelledby="ranger-range-title"]').evaluate(element => getComputedStyle(element, "::before").backgroundImage);
    assert.match(mountainOutpost, /ranger-range-mountain-outpost-v2\.png/);
    if (index === 0) {
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/ranger-range") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Start range" }).click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
    }
    const rangeCanvas = page.locator('canvas[data-dzn-ranger-range-canvas="true"]');
    await rangeCanvas.waitFor({ state: "visible" });
    const rangeVisual = await rangeCanvas.evaluate(element => {
      const canvas = element;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { width: canvas.width, height: canvas.height, litPixels: 0, distinct: 0 };
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let litPixels = 0;
      const colours = new Set();
      for (let pixel = 0; pixel < pixels.length; pixel += 16) {
        const red = pixels[pixel], green = pixels[pixel + 1], blue = pixels[pixel + 2];
        if (red + green + blue > 28) litPixels++;
        colours.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      }
      return { width: canvas.width, height: canvas.height, litPixels, distinct: colours.size };
    });
    assert.ok(rangeVisual.width > 250 && rangeVisual.height > 180, `${viewport.name} range canvas is undersized: ${JSON.stringify(rangeVisual)}`);
    assert.ok(rangeVisual.litPixels > 500 && rangeVisual.distinct > 20, `${viewport.name} range canvas appears blank: ${JSON.stringify(rangeVisual)}`);
    await page.getByRole("group", { name: "Ranger Range targets" }).waitFor();
    const targets = page.getByRole("group", { name: "Ranger Range targets" }).getByRole("button");
    assert.equal(await targets.count(), 6);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert.equal(noOverflow, true, `${viewport.name} viewport has horizontal overflow`);
    const allTouchSafe = await targets.evaluateAll(buttons => buttons.every(button => {
      const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
    }));
    assert.equal(allTouchSafe, true, `${viewport.name} target controls must stay touch-safe`);
    const computedAnimation = await targets.first().evaluate(button => getComputedStyle(button).animationName);
    assert.equal(computedAnimation, "none", "reduced-motion must suppress target animation");

    if (index === 0) {
      const stage = page.locator('[data-status][data-live="true"]');
      await stage.waitFor({ timeout: 5_000 });
      const liveTarget = stage.locator('button[data-live="true"]');
      await liveTarget.waitFor();
      assert.equal(await stage.locator('button[data-live="true"]').count(), 1);
      const key = await liveTarget.locator("kbd").innerText();
      const [arrowResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/ranger-range") && response.request().method() === "POST"),
        page.keyboard.press(key),
      ]);
      assert.equal(arrowResponse.status(), 200, await arrowResponse.text());
      await page.getByText("1 / 8", { exact: true }).waitFor();
      assert.equal(await page.locator('button[data-target][disabled]').count(), 6, "targets must close between server-issued windows");
    }
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Ranger Range desktop, tablet, and phone rendered QA passed.");
} finally {
  await browser?.close();
  preview.kill();
}

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
