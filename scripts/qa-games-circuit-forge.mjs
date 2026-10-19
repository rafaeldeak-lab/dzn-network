import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import sharp from "sharp";

const output = path.resolve("artifacts/games-circuit-forge");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  const port = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Circuit Forge preview did not start: ${log}`)), 20_000);
    preview.stdout.on("data", chunk => { log += chunk; const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    preview.stderr.on("data", chunk => { log += chunk; });
    preview.once("error", reject);
  });
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ name: "desktop", width: 1440, height: 980 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: viewport.name === "phone" ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/${viewport.name === "phone" ? "__local-login-other" : "__local-login"}`, { waitUntil: "networkidle" });
    await page.locator('[data-game="circuit-forge"]').click();
    await page.getByRole("heading", { name: "DZN Circuit Forge" }).waitFor();
    if (viewport.name === "desktop") {
      await page.getByRole("button", { name: "Start rebuild" }).click();
      await page.getByRole("grid", { name: "Circuit Forge power grid" }).waitFor({ state: "visible" });
      const diagnostic = page.locator('[data-grid-control="diagnose"]');
      await diagnostic.waitFor({ state: "visible" });
      await diagnostic.click();
      await page.locator('[data-diagnostic="true"]').waitFor({ state: "visible" });
      await page.waitForTimeout(180);
      const phase = page.locator('[data-grid-control="phase"]');
      await phase.click();
      await page.getByText("Phase lock spent", { exact: true }).waitFor({ state: "visible" });
    } else {
      await page.getByRole("button", { name: "Start rebuild" }).click();
      const diagnostic = page.locator('[data-grid-control="diagnose"]');
      await diagnostic.waitFor({ state: "visible" });
      await diagnostic.click();
      const diagnosticTile = page.locator('[data-diagnostic="true"]');
      await diagnosticTile.waitFor({ state: "visible" });
      assert.equal(await diagnosticTile.evaluate(element => getComputedStyle(element).animationName), "none");
    }
    await page.getByRole("grid", { name: "Circuit Forge power grid" }).waitFor({ state: viewport.name === "desktop" ? "visible" : "attached" });
    const canvas = page.locator('canvas[data-dzn-circuit-forge-canvas="true"]');
    await canvas.waitFor({ state: "visible" });
    const before = await canvas.screenshot();
    const pixels = await sharp(before).raw().toBuffer({ resolveWithObject: true });
    let bright = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.data.length; index += 12) {
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      if (red + green + blue > 260) bright++;
      colors.add(`${Math.floor(red / 32)}:${Math.floor(green / 32)}:${Math.floor(blue / 32)}`);
    }
    assert.ok(pixels.info.width > 220 && pixels.info.height > 200, "Circuit Forge canvas should be visibly sized");
    assert.ok(bright > 90, "Circuit Forge scene should include visible power-station highlights");
    assert.ok(colors.size > 22, "Circuit Forge scene should retain varied rendered colour detail");
    if (viewport.name === "phone") {
      const [frameHeight, canvasHeight] = await Promise.all([
        page.locator('[class*="circuitForgeSceneFrame"]').evaluate(element => element.getBoundingClientRect().height),
        canvas.evaluate(element => element.getBoundingClientRect().height),
      ]);
      assert.ok(Math.abs(frameHeight - canvasHeight) <= 2, `Circuit Forge's mobile scene frame should not leave an empty strip below the canvas (frame ${frameHeight}, canvas ${canvasHeight})`);
    }
    const relay = page.locator('[data-rotatable="true"]').first();
    await relay.waitFor();
    await relay.click();
    await page.waitForTimeout(180);
    assert.equal(await canvas.count(), 1);
    assert.notDeepEqual(await canvas.screenshot(), before);
    assert.equal(await page.locator('[role="gridcell"]').count(), 25);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Circuit Forge desktop and phone rendered QA passed.");
} finally {
  await browser?.close();
  preview.kill();
}
