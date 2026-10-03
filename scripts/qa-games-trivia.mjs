import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/games-trivia");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let previewLog = "";
preview.stdout.setEncoding("utf8"); preview.stderr.setEncoding("utf8");
preview.stdout.on("data", chunk => { previewLog += chunk; }); preview.stderr.on("data", chunk => { previewLog += chunk; });

const origin = await waitForOrigin();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /DZN Trivia/ }).click();
    await page.getByRole("heading", { name: "DZN Trivia" }).waitFor();
    const start = page.getByRole("button", { name: "Start round" });
    const answers = page.locator('div[class*="triviaChoices"] button');
    await page.waitForFunction(() => document.querySelector('div[class*="triviaChoices"] button')
      || [...document.querySelectorAll("button")].some(button => button.textContent?.includes("Start round") && !button.disabled));
    if (await answers.count() === 0) {
      await page.getByLabel("Trivia difficulty").selectOption("operator");
      await start.click();
    }
    await answers.first().waitFor();
    assert.equal(await answers.count(), 4);
    await page.reload({ waitUntil: "networkidle" });
    const [resumeResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/trivia") && response.request().method() === "GET"),
      page.getByRole("button", { name: /DZN Trivia/ }).click(),
    ]);
    const resumed = await resumeResponse.json();
    await answers.first().waitFor();
    assert.ok(resumed.game?.difficulty);
    assert.equal(await page.getByLabel("Trivia difficulty").inputValue(), resumed.game.difficulty);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const [answerResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith("/api/games/trivia") && response.request().method() === "POST"),
      answers.first().click(),
    ]);
    assert.equal(answerResponse.status(), 200);
    await answers.first().waitFor();
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Trivia desktop and phone rendered QA passed.");
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
