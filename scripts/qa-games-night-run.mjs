import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-night-run");
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
  for (const [index, scenario] of [
    { name: "desktop", width: 1440, height: 1000, reducedMotion: "no-preference" },
    { name: "phone", width: 390, height: 844, reducedMotion: "reduce" },
  ].entries()) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, reducedMotion: scenario.reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    const [loadResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/night-run") && response.request().method() === "GET"),
      page.getByRole("button", { name: /Night Run/ }).click(),
    ]);
    assert.equal(loadResponse.status(), 200, await loadResponse.text());
    await page.getByRole("heading", { name: "DZN Night Run" }).waitFor();
    if (index === 0) {
      const startRun = page.getByRole("button", { name: "Start night run" });
      await waitForEnabled(startRun, "the Night Run start control");
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/night-run") && response.request().method() === "POST"),
        startRun.click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
    }
    const canvas = page.locator('canvas[data-dzn-night-run-canvas="true"]');
    await canvas.waitFor({ state: "visible" });
    const lanes = page.getByRole("group", { name: "Night Run convoy lanes" }).getByRole("button");
    assert.equal(await lanes.count(), 3);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert.equal(noOverflow, true, `${scenario.name} viewport has horizontal overflow`);
    const touchSafe = await lanes.evaluateAll(buttons => buttons.every(button => {
      const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
    }));
    assert.equal(touchSafe, true, `${scenario.name} lane controls must stay touch-safe`);
    const cropState = await canvas.evaluate(element => ({
      width: element.clientWidth,
      height: element.clientHeight,
      parentWidth: element.parentElement?.clientWidth ?? 0,
      parentHeight: element.parentElement?.clientHeight ?? 0,
      crop: element.getAttribute("data-dzn-night-run-backdrop-fit"),
    }));
    const expectedBackdropFit = cropState.width / cropState.height >= 16 / 9 ? "crop-y" : "crop-x";
    await waitForAttribute(canvas, "data-dzn-night-run-backdrop-fit", expectedBackdropFit);
    assert.equal(await canvas.getAttribute("data-dzn-night-run-backdrop-fit"), expectedBackdropFit, `${scenario.name} must crop the city art without stretching it: ${JSON.stringify(cropState)}`);

    // Let the server-issued gate arrive before comparing frame counters; the renderer remounts once to adopt its live lane.
    await page.waitForTimeout(900);
    const before = Number(await canvas.getAttribute("data-render-frames"));
    await page.waitForTimeout(260);
    const after = Number(await canvas.getAttribute("data-render-frames"));
    const pixelState = await canvas.evaluate(element => {
      const canvas = element;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { width: canvas.width, height: canvas.height, lit: 0, colors: 0 };
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0; const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 16) {
        const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
        if (red + green + blue > 30) lit++;
        colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      }
      return { width: canvas.width, height: canvas.height, lit, colors: colors.size };
    });
    assert.ok(pixelState.width >= 280 && pixelState.height >= 220, JSON.stringify(pixelState));
    assert.ok(pixelState.lit > pixelState.width * pixelState.height * 0.008, `Night Run canvas is blank: ${JSON.stringify(pixelState)}`);
    assert.ok(pixelState.colors > 18, `Night Run canvas lacks colour range: ${JSON.stringify(pixelState)}`);
    if (scenario.reducedMotion === "reduce") assert.ok(after - before <= 1, `Reduced motion must hold the scene still: ${before} -> ${after}`);
    else assert.ok(after > before + 2, `Night Run must animate: ${before} -> ${after}`);
    await canvas.screenshot({ path: path.join(output, `${scenario.name}-canvas.png`) });
    await page.screenshot({ path: path.join(output, `${scenario.name}.png`), fullPage: false });

    if (index === 0) {
      await page.locator('[data-live="true"][data-lane]').waitFor({ timeout: 5_000 });
      const liveLane = page.locator('[data-live="true"][data-lane]');
      await waitForEnabled(liveLane, "the live lane");
      await liveLane.click({ force: true });
      await page.getByText("1 / 9", { exact: true }).waitFor({ timeout: 5_000 });
      assert.equal(await page.locator('[data-lane][disabled]').count(), 3, "lanes must close between server-issued gates");
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Night Run desktop, phone, canvas, interaction and reduced-motion QA passed.");
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

async function waitForEnabled(locator, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await locator.isEnabled()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await locator.isEnabled(), true, `${label} must become enabled`);
}

async function waitForAttribute(locator, name, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await locator.getAttribute(name) === expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
