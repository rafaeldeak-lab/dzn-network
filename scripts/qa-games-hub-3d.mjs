import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-hub-3d");
await mkdir(output, { recursive: true });

const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
const preview = spawn(process.execPath, [tsxCli, "scripts/dev-games-hub.ts"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let previewLog = "";
preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
preview.stdout.on("data", chunk => { previewLog += chunk; });
preview.stderr.on("data", chunk => { previewLog += chunk; });

const origin = await waitForOrigin();
const browser = await chromium.launch({ headless: true });
const results = [];
const requestedViewport = Number(process.env.DZN_QA_VIEWPORT ?? 0);
const requestedMotion = process.env.DZN_QA_MOTION;
const scenarios = [
  { width: 1440, height: 1000, reducedMotion: "no-preference" },
  { width: 390, height: 844, reducedMotion: "no-preference" },
  { width: 390, height: 844, reducedMotion: "reduce" },
].filter((scenario) => (!requestedViewport || scenario.width === requestedViewport) && (!requestedMotion || scenario.reducedMotion === requestedMotion));

try {
  assert.ok(scenarios.length > 0, "Games Hub visual QA scenario filter selected no viewports.");
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, reducedMotion: scenario.reducedMotion });
    const page = await context.newPage();
    const errors = [], failed = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    page.on("request", request => { if (request.method() !== "GET" && request.method() !== "HEAD") writes.push({ url: request.url(), method: request.method(), body: request.postDataJSON?.() }); });

    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    if (scenario.width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `operations-${scenario.width}-${scenario.reducedMotion}.png`) });
    }
    const canvas = page.locator('canvas[data-dzn-minefield-canvas="true"]');
    const briefingImage = page.getByAltText("Night tactical clearance sector with a reconnaissance drone and survey beacons");
    let briefing = null;
    if (await canvas.count() === 0) {
      await briefingImage.waitFor({ state: "visible" });
      briefing = await briefingImage.evaluate(image => {
        const board = image.closest('[class*="readyBoard"]');
        const bounds = board?.getBoundingClientRect();
        return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
      });
      assert.ok(briefing.naturalWidth > 600 && briefing.naturalHeight > 300, `Minefield briefing image did not load: ${JSON.stringify(briefing)}`);
      assert.ok(briefing.width <= scenario.width && briefing.height >= 300, `Minefield briefing must remain visible and bounded: ${JSON.stringify(briefing)}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Minefield briefing overflow at ${scenario.width}px`);
      await page.screenshot({ path: path.join(output, `briefing-${scenario.width}-${scenario.reducedMotion}.png`), fullPage: true });
      await page.getByRole("button", { name: "Start mission" }).click();
    }
    await canvas.waitFor({ state: "visible" });
    await page.waitForTimeout(350);

    const before = Number(await canvas.getAttribute("data-render-frames"));
    await page.waitForTimeout(250);
    const after = Number(await canvas.getAttribute("data-render-frames"));
    const canvasState = await canvas.evaluate(element => {
      const canvas = element;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { width: canvas.width, height: canvas.height, litPixels: 0, distinct: 0 };
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let litPixels = 0;
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 16) {
        const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
        if (red + green + blue > 28) litPixels++;
        colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      }
      return { width: canvas.width, height: canvas.height, litPixels, distinct: colors.size };
    });
    const commandTable = await page.locator(".dzn-minefield-3d").evaluate(element => getComputedStyle(element).backgroundImage);
    assert.match(commandTable, /sector-sweep-command-v1\.png/);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      field: document.querySelector(".dzn-minefield-3d")?.getBoundingClientRect().toJSON(),
      main: document.querySelector("main")?.getBoundingClientRect().toJSON(),
      motion: document.querySelector("main")?.getAttribute("data-motion"),
      operations: (() => {
        const picker = document.querySelector('[aria-label="Choose an operation"]');
        if (!(picker instanceof HTMLElement)) return null;
        const style = getComputedStyle(picker);
        return { autoFlow: style.gridAutoFlow, rows: style.gridTemplateRows, scrollWidth: picker.scrollWidth, clientWidth: picker.clientWidth };
      })(),
    }));

    assert.equal(layout.overflow, false, `Games Hub overflow at ${scenario.width}px`);
    assert.ok(canvasState.width >= 300 && canvasState.height >= 300, JSON.stringify(canvasState));
    assert.ok(canvasState.litPixels > 3000, `Canvas must contain rendered pixels: ${JSON.stringify(canvasState)}`);
    assert.ok(canvasState.distinct > 18, `Canvas must contain a real colour range: ${JSON.stringify(canvasState)}`);
    assert.ok(layout.field.width <= layout.main.width + 1, "3D field must stay inside the page");
    if (scenario.width === 390) {
      assert.equal(layout.operations?.autoFlow, "column", "Phone operation picker must use a compact two-row rail.");
      assert.notEqual(layout.operations?.rows, "none", "Phone operation picker must reserve two grid rows.");
      assert.ok((layout.operations?.scrollWidth ?? 0) > (layout.operations?.clientWidth ?? 0), "Phone operation picker must keep the catalogue horizontally browseable.");
      await page.locator('[aria-label="Choose an operation"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `operations-rail-${scenario.width}-${scenario.reducedMotion}.png`) });
    }
    if (scenario.reducedMotion === "reduce") {
      assert.equal(layout.motion, "paused");
      assert.ok(after - before <= 1, `Reduced-motion scene should stay static: ${before} -> ${after}`);
    } else {
      assert.equal(layout.motion, "running");
      assert.ok(after > before + 2, `Animated scene must keep rendering: ${before} -> ${after}`);
    }

    await canvas.screenshot({ path: path.join(output, `field-${scenario.width}-${scenario.reducedMotion}.png`) });
    await page.screenshot({ path: path.join(output, `games-field-${scenario.width}-${scenario.reducedMotion}.png`), fullPage: true });

    if (scenario.width === 1440) {
      const version = await page.locator(".dzn-minefield-3d").getAttribute("data-game-version");
      const scannerButton = page.getByRole("button", { name: "Clear an opening sector before scanner deployment", exact: true });
      assert.equal(await scannerButton.isDisabled(), true, "A scanner must not report before the guaranteed-safe opening is established");
      await canvas.click({ position: { x: Math.round((await canvas.evaluate(element => element.clientWidth)) / 2), y: Math.round((await canvas.evaluate(element => element.clientHeight)) / 2) } });
      await page.waitForFunction(previous => document.querySelector(".dzn-minefield-3d")?.getAttribute("data-game-version") !== previous, version);
      const move = writes.map(entry => entry.body).find(body => body?.action === "move");
      assert.deepEqual(Object.keys(move).sort(), ["action", "gameId", "tool", "version", "x", "y"], "3D interaction must use the existing bounded move contract");
      assert.equal(move.tool, "reveal");
      const readyScanner = page.getByRole("button", { name: "Deploy a local threat scan", exact: true });
      assert.equal(await readyScanner.isDisabled(), false);
      await readyScanner.click();
      const scanPositions = [[0.2, 0.3], [0.8, 0.3], [0.2, 0.7], [0.8, 0.7], [0.5, 0.24], [0.5, 0.76]];
      let scanned = false;
      let scannedAt = null;
      for (const [x, y] of scanPositions) {
        const scanVersion = await page.locator(".dzn-minefield-3d").getAttribute("data-game-version");
        await canvas.click({ position: { x: Math.round((await canvas.evaluate(element => element.clientWidth)) * x), y: Math.round((await canvas.evaluate(element => element.clientHeight)) * y) } });
        try {
          await page.waitForFunction(previous => document.querySelector(".dzn-minefield-3d")?.getAttribute("data-game-version") !== previous, scanVersion, { timeout: 1_200 });
          scanned = true;
          scannedAt = { x, y };
          break;
        } catch { /* Try the next visible sector until a hidden tile is intersected. */ }
      }
      assert.equal(scanned, true, "3D field should expose a hidden sector for an available scanner charge");
      assert.ok(scannedAt);
      const scan = writes.map(entry => entry.body).find(body => body?.action === "scan");
      assert.deepEqual(Object.keys(scan).sort(), ["action", "gameId", "version", "x", "y"], "3D scanner must use its bounded server scan contract");
      const scanIntel = page.getByRole("region", { name: "Local 3 x 3 threat density", exact: true });
      await scanIntel.locator("li").waitFor();
      assert.match(await scanIntel.textContent(), /\d+ threats?/, "Scanner intelligence must render the server threat count outside the decorative canvas");
      const flagVersion = await page.locator(".dzn-minefield-3d").getAttribute("data-game-version");
      await canvas.click({ button: "right", position: { x: Math.round((await canvas.evaluate(element => element.clientWidth)) * scannedAt.x), y: Math.round((await canvas.evaluate(element => element.clientHeight)) * scannedAt.y) } });
      await page.waitForFunction(previous => document.querySelector(".dzn-minefield-3d")?.getAttribute("data-game-version") !== previous, flagVersion);
      const flagMove = writes.map(entry => entry.body).filter(body => body?.action === "move").at(-1);
      assert.equal(flagMove.tool, "flag", "3D right-click must place a containment marker even while the scanner is selected");
      await page.getByRole("button", { name: "Tactical grid", exact: true }).click();
      await page.getByRole("group", { name: /Sector Sweep board/i }).waitFor();
      const scannedCell = page.locator(`button[data-index="${scan.y * 10 + scan.x}"]`);
      assert.match(await scannedCell.getAttribute("aria-label"), /Scan result: \d+ threats? in the local 3 by 3 sector/, "Tactical grid must expose the exact scan result to assistive technology");
      await scannedCell.focus();
      const writeCount = writes.length;
      await page.keyboard.press("s");
      await page.waitForTimeout(150);
      assert.equal(writes.length, writeCount, "Scanner shortcut must not submit a duplicate scan for an already scanned sector");
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    await page.screenshot({ path: path.join(output, `games-${scenario.width}-${scenario.reducedMotion}.png`), fullPage: true });
    results.push({ ...scenario, briefing, before, after, canvasState, layout, writes: writes.map(entry => ({ method: entry.method, path: new URL(entry.url).pathname, action: entry.body?.action })) });
    await context.close();
  }
  const fallbackContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  try {
    await fallbackContext.addInitScript(() => {
      Object.defineProperty(window, "WebGLRenderingContext", { configurable: true, value: undefined });
    });
    const fallbackPage = await fallbackContext.newPage();
    const fallbackErrors = [];
    fallbackPage.on("pageerror", error => fallbackErrors.push(error.message));
    await fallbackPage.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    await fallbackPage.getByRole("group", { name: /Sector Sweep board/i }).waitFor();
    assert.equal(await fallbackPage.locator('canvas[data-dzn-minefield-canvas="true"]').count(), 0);
    assert.equal(await fallbackPage.getByRole("button", { name: "Tactical grid", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await fallbackPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(fallbackErrors, []);
  } finally {
    await fallbackContext.close();
  }
  await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log("Games Hub 3D canvas, interaction, reduced-motion and responsive QA passed.");
} finally {
  await browser.close();
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
