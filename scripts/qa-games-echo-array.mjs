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
      page.getByRole("button", { name: /Echo Array/ }).click(),
    ]);
    assert.equal(loadResponse.status(), 200, await loadResponse.text());
    await page.getByRole("heading", { name: "DZN Echo Array" }).waitFor();
    const signalChamber = await page.locator('[aria-labelledby="echo-array-title"]').evaluate(element => getComputedStyle(element, "::before").backgroundImage);
    assert.match(signalChamber, /echo-array-signal-chamber-v2\.png/);
    if (index === 0) {
      const [startResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/echo-array") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Start echo" }).click(),
      ]);
      assert.equal(startResponse.status(), 200, await startResponse.text());
    }
    await page.getByRole("group", { name: "Echo Array signal nodes" }).waitFor();
    await page.getByText("Repeat the stored signal", { exact: true }).waitFor({ timeout: 8_000 });
    const nodeButtons = page.locator('[aria-label^="North array"], [aria-label^="East array"], [aria-label^="South array"], [aria-label^="West array"]');
    assert.equal(await nodeButtons.count(), 4);
    assert.equal(await nodeButtons.evaluateAll(nodes => nodes.every(node => !node.hasAttribute("disabled"))), true);
    if (index === 0) {
      const [tapResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/echo-array") && response.request().method() === "POST"),
        nodeButtons.first().click(),
      ]);
      assert.equal(tapResponse.status(), 200, await tapResponse.text());
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
