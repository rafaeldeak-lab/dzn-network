import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const output = path.resolve("artifacts/games-outpost-run");
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
      page.waitForResponse(response => response.url().endsWith("/api/games/outpost-run") && response.request().method() === "GET"),
      page.locator('[data-game="outpost-run"]').click(),
    ]);
    assert.equal(loadResponse.status(), 200, await loadResponse.text());
    await page.getByRole("heading", { name: "DZN Outpost Run" }).waitFor();
    if (index === 0) {
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/outpost-run") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Start run" }).click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
      await page.waitForTimeout(260);
      const [scanResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/outpost-run") && response.request().method() === "POST"),
        page.getByRole("button", { name: /Use beacon scanner/ }).click(),
      ]);
      assert.equal(scanResponse.status(), 200, await scanResponse.text());
      await page.waitForTimeout(260);
      await page.getByText("FIELD SUPPORT").waitFor();
      const [reconResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/outpost-run") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Deploy recon drone" }).click(),
      ]);
      assert.equal(reconResponse.status(), 200, await reconResponse.text());
      await page.waitForTimeout(260);
      const [shieldResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/outpost-run") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Arm storm shield" }).click(),
      ]);
      assert.equal(shieldResponse.status(), 200, await shieldResponse.text());
      const [moveResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/outpost-run") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Move north" }).click(),
      ]);
      assert.equal(moveResponse.status(), 200, await moveResponse.text());
    }
    await page.getByRole("grid", { name: "Outpost Run fog grid" }).waitFor();
    const terrainCanvas = page.locator('[data-dzn-outpost-run-canvas="true"]');
    await terrainCanvas.waitFor();
    assert.equal(await terrainCanvas.count(), 1, "Outpost Run should render exactly one tactical terrain canvas.");
    if (index === 0) {
      assert.equal(await terrainCanvas.getAttribute("data-dzn-outpost-run-shield"), "armed");
      assert.match(await page.getByRole("button", { name: "Recon sweep complete" }).textContent() ?? "", /nearby sectors mapped/);
    }
    const terrainBounds = await terrainCanvas.evaluate(canvas => {
      const bounds = canvas.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, pixels: canvas.width * canvas.height };
    });
    assert.ok(terrainBounds.width >= 260 && terrainBounds.height >= 140, "The tactical terrain should retain a usable visual footprint.");
    assert.ok(terrainBounds.pixels > 20_000, "The tactical terrain canvas should have a real render buffer.");
    const terrainImage = await sharp(await terrainCanvas.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let litPixels = 0;
    const sampledColours = new Set();
    for (let offset = 0; offset < terrainImage.data.length; offset += terrainImage.info.channels * 19) {
      const red = terrainImage.data[offset]; const green = terrainImage.data[offset + 1]; const blue = terrainImage.data[offset + 2];
      if (red + green + blue > 75) litPixels++;
      sampledColours.add(`${Math.floor(red / 24)}:${Math.floor(green / 24)}:${Math.floor(blue / 24)}`);
    }
    assert.ok(litPixels > 80, "The tactical terrain must contain visible mission lighting, not a black canvas.");
    assert.ok(sampledColours.size > 18, "The tactical terrain must contain meaningful visual detail, not a flat placeholder.");
    if (index === 0) {
      assert.equal(await page.locator('[data-objective="beacon"]').first().textContent(), "beacon required");
      assert.match(await page.getByText("Secure the field beacon before extraction").textContent() ?? "", /field beacon/);
    }
    assert.equal(await page.locator('[role="gridcell"]').count(), 25);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  const motionPage = await motionContext.newPage();
  await motionPage.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
  await motionPage.locator('[data-game="outpost-run"]').click();
  await motionPage.getByRole("grid", { name: "Outpost Run fog grid" }).waitFor();
  await motionPage.waitForFunction(() => document.querySelector('main[data-motion="running"]') !== null);
  const sweepName = await readSweep(motionPage, "animation-name");
  assert.match(sweepName, /outpost-run-sweep/);
  const sweepPositions = [];
  for (let sample = 0; sample < 7; sample++) {
    sweepPositions.push(Number.parseFloat(await readSweep(motionPage, "top")));
    await motionPage.waitForTimeout(400);
  }
  assert.ok(Math.max(...sweepPositions) - Math.min(...sweepPositions) > 100, "The tactical scanner should cross the map, not only its own line height.");
  await motionContext.close();

  const pausedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  await pausedContext.addInitScript(() => localStorage.setItem("dzn.games.motion", "paused"));
  const pausedPage = await pausedContext.newPage();
  await pausedPage.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
  await pausedPage.locator('[data-game="outpost-run"]').click();
  await pausedPage.getByRole("grid", { name: "Outpost Run fog grid" }).waitFor();
  await pausedPage.waitForFunction(() => document.querySelector('main[data-motion="paused"]') !== null);
  assert.equal(await readSweep(pausedPage, "animation-name"), "none");
  await pausedContext.close();
  console.log("DZN Outpost Run desktop and phone rendered QA passed.");
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

async function readSweep(page, property) {
  return page.getByRole("grid", { name: "Outpost Run fog grid" }).evaluate((grid, propertyName) => {
    const sweep = [...(grid.parentElement?.querySelectorAll('span[aria-hidden="true"]') ?? [])].find(element => !element.textContent);
    if (!sweep) throw new Error("Outpost Run scanner sweep was not rendered.");
    return getComputedStyle(sweep, "::after").getPropertyValue(propertyName);
  }, property);
}
