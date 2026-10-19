import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-echo-array");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
});
let previewLog = "";
preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
preview.stdout.on("data", chunk => { previewLog += chunk; }); preview.stderr.on("data", chunk => { previewLog += chunk; });

let browser;
try {
  const origin = await waitForOrigin();
  browser = await chromium.launch({ headless: true });
  for (const [index, viewport] of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 390, height: 844 }].entries()) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    const [loadResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/echo-array") && response.request().method() === "GET"),
      page.locator('[data-game="echo-array"]').click(),
    ]);
    assert.equal(loadResponse.status(), 200);
    const initialState = await loadResponse.json();
    await page.getByRole("heading", { name: "DZN Echo Array" }).waitFor();
    const signalChamber = await page.locator('[aria-labelledby="echo-array-title"]').evaluate(element => getComputedStyle(element, "::before").backgroundImage);
    assert.match(signalChamber, /echo-array-signal-chamber-v2\.png/);
    const hasActiveGame = initialState.game?.status === "playing";
    if (index === 0 && !hasActiveGame) {
      const startButton = page.getByRole("button", { name: /^(Start|New) echo$/ });
      await startButton.waitFor({ state: "visible" });
      if (await startButton.isDisabled()) await page.waitForTimeout(5_200);
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/echo-array") && response.request().method() === "POST"),
        startButton.click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
      await page.getByLabel("Live server cue buffer").waitFor();
      assert.ok(await page.locator('[aria-label$=" cue"]').count() <= 1,
        "Echo Array must not expose future sequence cues before their server-issued pulse.");
      await page.waitForTimeout(1_600);
      assert.ok(await page.locator('[aria-label$=" cue"]').count() <= 1,
        "Echo Array must not retain prior cues after a later server-issued pulse begins.");
    }
    await page.getByRole("group", { name: "Echo Array signal nodes" }).waitFor();
    await page.getByText("Repeat the stored signal", { exact: true }).waitFor({ timeout: 8_000 });
    await page.getByLabel("Locked cue buffer").waitFor();
    assert.equal(await page.locator('[aria-label$=" cue"]').count(), 0,
      "Echo Array must clear every cue label before accepting player input.");
    const echoCanvas = page.locator('canvas[data-dzn-echo-array-canvas="true"]');
    await echoCanvas.waitFor({ state: "visible" });
    assert.equal(await echoCanvas.count(), 1);
    await echoCanvas.scrollIntoViewIfNeeded();
    const commandScene = page.locator('[class*="echoArrayConsole"]');
    const commandSceneBounds = await commandScene.evaluate(element => ({
      console: element.getBoundingClientRect().height,
      scene: element.querySelector('[class*="dzn-echo-array-3d"]')?.getBoundingClientRect().height ?? 0,
      controls: element.querySelector('[class*="echoArrayControlDeck"]')?.getBoundingClientRect().height ?? 0,
      stage: element.parentElement?.getBoundingClientRect().height ?? 0,
    }));
    const isPhone = viewport.name === "phone";
    assert.ok(commandSceneBounds.scene >= (isPhone ? 250 : 290) && commandSceneBounds.scene <= 400,
      `Echo Array 3D scene should remain bounded: ${JSON.stringify(commandSceneBounds)}.`);
    assert.ok(commandSceneBounds.console <= (isPhone ? 650 : 430) && commandSceneBounds.stage <= (isPhone ? 900 : 650),
      `Echo Array command layout should remain compact: ${JSON.stringify(commandSceneBounds)}.`);
    const canvasState = await echoCanvas.evaluate(element => {
      const canvas = element;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { width: canvas.width, height: canvas.height, litPixels: 0, colors: 0 };
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let litPixels = 0;
      const colors = new Set();
      for (let offset = 0; offset < pixels.length; offset += 16) {
        const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
        if (red + green + blue > 28) litPixels++;
        colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      }
      return { width: canvas.width, height: canvas.height, litPixels, colors: colors.size };
    });
    assert.ok(canvasState.width >= 280 && canvasState.height >= (isPhone ? 240 : 280), `Echo Array canvas is undersized: ${JSON.stringify(canvasState)}`);
    assert.ok(canvasState.litPixels > canvasState.width * canvasState.height * 0.008, `Echo Array canvas is blank: ${JSON.stringify(canvasState)}`);
    assert.ok(canvasState.colors > 18, `Echo Array canvas lacks colour range: ${JSON.stringify(canvasState)}`);
    await echoCanvas.screenshot({ path: path.join(output, `${viewport.name}-canvas.png`) });
    const nodeButtons = page.locator('[aria-label^="North array"], [aria-label^="East array"], [aria-label^="South array"], [aria-label^="West array"]');
    assert.equal(await nodeButtons.count(), 4);
    assert.equal(await nodeButtons.evaluateAll(nodes => nodes.every(node => !node.hasAttribute("disabled"))), true);
    if (index === 0) {
      const [tapResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/echo-array") && response.request().method() === "POST"),
        nodeButtons.first().click(),
      ]);
      assert.equal(tapResponse.status(), 200, await tapResponse.text());
      assert.equal(await echoCanvas.count(), 1);
    }
    await page.getByText(/Stage 1 \/ 3/, { exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Echo Array desktop and phone rendered QA passed.");
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
