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
    const [loadResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/hide-seek") && response.request().method() === "GET"),
      page.getByRole("button", { name: /Signal Hunt/ }).click(),
    ]);
    assert.equal(loadResponse.status(), 200);
    await page.getByRole("heading", { name: "DZN Signal Hunt" }).waitFor();
    const scene = page.getByRole("group", { name: "DZN signal hunt reconnaissance scene" });
    const startButton = page.getByRole("button", { name: /^(Start hunt|New hunt)$/ });
    if (await startButton.count()) {
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/hide-seek") && response.request().method() === "POST"),
        startButton.click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
    }
    assert.equal(await scene.evaluate(element => getComputedStyle(element, "::after").animationName), "none");
    assert.equal(await page.locator('[class*="hideSeekTarget"]').count(), 0, "Unrecovered target markers must not be emitted into the DOM.");
    assert.equal(await page.locator('[class*="hideSeekRecovered"]').count(), 0, "No recovered marker should exist before a server-confirmed scan.");
    await scene.focus();
    for (let press = 0; press < 10; press++) await page.keyboard.press("ArrowRight");
    await page.getByText("X 1000 / Y 0500").waitFor();
    const [scanResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/hide-seek") && response.request().method() === "POST"),
      page.keyboard.press("Enter"),
    ]);
    assert.equal(scanResponse.status(), 200, await scanResponse.text());
    await page.getByText("Empty sweep").waitFor();
    assert.equal(await page.locator('[class*="hideSeekRecovered"]').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
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
