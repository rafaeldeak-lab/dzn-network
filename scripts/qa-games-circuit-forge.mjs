import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

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
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Circuit Forge/ }).click();
    await page.getByRole("heading", { name: "DZN Circuit Forge" }).waitFor();
    if (viewport.name === "desktop") {
      await page.getByRole("button", { name: "Start rebuild" }).click();
      await page.getByRole("grid", { name: "Circuit Forge power grid" }).waitFor({ state: "visible" });
    }
    await page.getByRole("grid", { name: "Circuit Forge power grid" }).waitFor({ state: viewport.name === "desktop" ? "visible" : "attached" });
    const canvas = page.locator('canvas[data-dzn-circuit-forge-canvas="true"]');
    await canvas.waitFor({ state: "visible" });
    const before = await canvas.screenshot();
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
