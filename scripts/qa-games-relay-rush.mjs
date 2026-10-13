import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-relay-rush");
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
  for (const [index, viewport] of [{ name: "desktop-delayed-link", width: 1440, height: 1000, requestDelay: 360 }, { name: "phone", width: 390, height: 844 }].entries()) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    if (viewport.requestDelay) {
      await page.route("**/api/games/relay-rush", async route => {
        await new Promise(resolve => setTimeout(resolve, viewport.requestDelay));
        await route.continue();
      });
    }
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    const [loadResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "GET"),
      page.getByRole("button", { name: /Relay Rush/ }).click(),
    ]);
    assert.equal(loadResponse.status(), 200, await loadResponse.text());
    await page.getByRole("heading", { name: "DZN Relay Rush" }).waitFor();
    if (index === 0) {
      const startRun = page.getByRole("button", { name: "Start run" });
      for (let attempt = 0; attempt < 20 && !(await startRun.isEnabled()); attempt++) await page.waitForTimeout(50);
      assert.equal(await startRun.isEnabled(), true, "Relay Rush must become startable after a delayed state response settles.");
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "POST"),
        startRun.click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
      const liveLane = page.locator('button[data-target="true"]');
      await liveLane.waitFor();
      const lane = await liveLane.getAttribute("data-lane");
      const key = lane === "left" ? "KeyA" : lane === "centre" ? "KeyS" : "KeyD";
      const [pulseResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/relay-rush") && response.request().method() === "POST"),
        page.keyboard.press(key),
      ]);
      assert.equal(pulseResponse.status(), 200, await pulseResponse.text());
      await page.getByText("1 / 12 pulses", { exact: true }).waitFor();
      assert.equal(await page.getByRole("group", { name: "Relay Rush signal lanes" }).locator('button[disabled]').count(), 3);
    } else {
      await page.getByRole("group", { name: "Relay Rush signal lanes" }).waitFor();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Relay Rush desktop, phone and injected-delay rendered QA passed.");
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
