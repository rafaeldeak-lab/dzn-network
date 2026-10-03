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

const origin = await waitForOrigin();
const browser = await chromium.launch({ headless: true });
try {
  for (const [index, viewport] of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 390, height: 844 }].entries()) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
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
    if (index === 0) {
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/hide-seek") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Start hunt" }).click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
      for (let target = 0; target < 4; target++) {
        const button = page.getByRole("button", { name: /Investigate concealed signal/ }).first();
        await button.waitFor();
        const [scanResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith("/api/games/hide-seek") && response.request().method() === "POST"),
          button.click(),
        ]);
        assert.equal(scanResponse.status(), 200, await scanResponse.text());
      }
      await page.getByText("All signals recovered").waitFor();
      await page.getByText(/Daily reward recorded/).waitFor();
    } else {
      await page.getByText("All signals recovered").waitFor();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Signal Hunt desktop and phone rendered QA passed.");
} finally { await browser.close(); preview.kill(); }

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
