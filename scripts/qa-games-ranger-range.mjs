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
      page.locator('[data-game="ranger-range"]').click(),
    ]);
    assert.equal(loadResponse.status(), 200, await loadResponse.text());
    await page.getByRole("heading", { name: "DZN Ranger Range" }).waitFor();
    const rangeCommandArt = await page.locator('[aria-labelledby="ranger-range-title"]').evaluate(element => getComputedStyle(element, "::before").backgroundImage);
    assert.match(rangeCommandArt, /ranger-range-command-v2\.webp/);
    if (index === 0) {
      const operations = page.getByRole("group", { name: "Ranger Range operations" });
      const operationCount = await operations.getByRole("button").count();
      let expectedCourse = null;
      if (operationCount) {
        assert.equal(operationCount, 3, "Ranger Range must present three distinct field operations before a run starts.");
        const blackoutWatch = operations.getByRole("button", { name: /Blackout watch/i });
        await blackoutWatch.click();
        assert.equal(await blackoutWatch.getAttribute("aria-pressed"), "true");
        expectedCourse = "blackout";
      }
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/ranger-range") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Start range" }).click(),
      ]);
      const startText = await startResponse.text();
      assert.equal(startResponse.status(), 200, startText);
      if (expectedCourse) assert.equal(JSON.parse(startText).game?.course, expectedCourse);
    }
    const rangeCanvas = page.locator('canvas[data-dzn-ranger-range-canvas="true"]');
    await rangeCanvas.waitFor({ state: "visible" });
    const rangeBackdrop = await page.locator(".dzn-ranger-range-3d").evaluate(element => getComputedStyle(element).backgroundImage);
    assert.match(rangeBackdrop, /ranger-range-command-v2\.webp/);
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
    assert.ok(rangeVisual.litPixels > 100 && rangeVisual.distinct > 9, `${viewport.name} interactive target layer appears blank: ${JSON.stringify(rangeVisual)}`);
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
      const fireLiveShot = async expectedShotsCleared => {
        const stage = page.locator('[data-status][data-live="true"]');
        await stage.waitFor({ timeout: 5_000 });
        const liveTarget = stage.locator('button[data-live="true"]');
        await liveTarget.waitFor();
        assert.equal(await stage.locator('button[data-live="true"]').count(), 1);
        assert.equal(await liveTarget.isDisabled(), true, "The plate must stay locked until the player sets a wind hold.");
        const windCall = await stage.locator("[data-ranger-wind] span").innerText();
        const normalizedWindCall = windCall.toLowerCase();
        const holdName = normalizedWindCall.includes("from left") ? "Hold left" : normalizedWindCall.includes("from right") ? "Hold right" : "Hold centre";
        const sightDeck = page.getByRole("group", { name: "Ranger Range sight hold" });
        assert.equal(await sightDeck.getByRole("button").count(), 3);
        const holdButton = sightDeck.getByRole("button", { name: new RegExp(`^${holdName}`) });
        await holdButton.click();
        assert.equal(await holdButton.getAttribute("aria-pressed"), "true");
        assert.equal(await liveTarget.isDisabled(), false, "The plate must open only after a valid hold has been selected.");
        const key = await liveTarget.locator("kbd").innerText();
        const [arrowResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith("/api/games/ranger-range") && response.request().method() === "POST"),
          page.keyboard.press(key),
        ]);
        const arrowText = await arrowResponse.text();
        assert.equal(arrowResponse.status(), 200, arrowText);
        const arrowPayload = JSON.parse(arrowText);
        assert.equal(arrowPayload.game?.shotsCleared, expectedShotsCleared,
          `Expected ${holdName} to clear ${windCall}; received ${JSON.stringify(arrowPayload.game)}`);
        await page.getByText(`${expectedShotsCleared} / 8`, { exact: true }).waitFor();
        return windCall;
      };

      await fireLiveShot(1);
      assert.equal(await page.locator('button[data-target][disabled]').count(), 6, "targets must close between server-issued windows");
      await fireLiveShot(2);
      const crosswind = await fireLiveShot(3);
      assert.match(crosswind, /crosswind from (left|right)/i, "The third range shot must verify a live non-calm hold.");
    }
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const fallbackContext = await browser.newContext({ viewport: { width: 834, height: 900 }, reducedMotion: "reduce" });
  try {
    await fallbackContext.addInitScript(() => {
      Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: undefined });
    });
    const fallbackPage = await fallbackContext.newPage();
    const fallbackErrors = [];
    fallbackPage.on("pageerror", error => fallbackErrors.push(error.message));
    await fallbackPage.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    await fallbackPage.locator('[data-game="ranger-range"]').click();
    // The isolated preview intentionally shares one synthetic player fixture across
    // browser contexts. Reuse the range opened by the desktop pass rather than
    // attempting a competing second start, so this path tests only the WebGL fallback.
    await fallbackPage.getByRole("group", { name: "Ranger Range targets" }).waitFor();
    const fallbackMount = fallbackPage.locator(".dzn-ranger-range-3d");
    await fallbackMount.waitFor({ state: "attached" });
    await fallbackPage.waitForFunction(() => document.querySelector(".dzn-ranger-range-3d")?.getAttribute("data-webgl-fallback") === "true");
    const fallbackPresentation = await fallbackMount.evaluate(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { state: element.getAttribute("data-webgl-fallback"), display: style.display, visibility: style.visibility, width: rect.width, height: rect.height, background: style.backgroundImage };
    });
    assert.equal(fallbackPresentation.state, "true", `WebGL fallback state was not applied: ${JSON.stringify(fallbackPresentation)}`);
    assert.equal(fallbackPresentation.display, "block", `WebGL fallback mount is not displayed: ${JSON.stringify(fallbackPresentation)}`);
    assert.notEqual(fallbackPresentation.visibility, "hidden", `WebGL fallback mount is hidden: ${JSON.stringify(fallbackPresentation)}`);
    assert.ok(fallbackPresentation.width > 300 && fallbackPresentation.height >= 300, `WebGL fallback mount has no visible area: ${JSON.stringify(fallbackPresentation)}`);
    assert.match(fallbackPresentation.background, /ranger-range-command-v2\.webp/);
    assert.equal(await fallbackPage.locator('canvas[data-dzn-ranger-range-canvas="true"]').count(), 0);
    assert.equal(await fallbackPage.getByRole("group", { name: "Ranger Range targets" }).getByRole("button").count(), 6);
    assert.deepEqual(fallbackErrors, []);
  } finally {
    await fallbackContext.close();
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
