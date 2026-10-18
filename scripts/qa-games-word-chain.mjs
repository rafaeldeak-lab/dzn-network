import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const output = path.resolve("artifacts/games-word-chain");
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
    await page.locator('button[data-game="word-chain"]').click();
    await page.getByRole("heading", { name: "DZN Word Chain" }).waitFor();
    const state = await page.evaluate(async () => {
      const response = await fetch("/api/games/word-chain", { credentials: "include", cache: "no-store" });
      return { status: response.status, payload: await response.json() };
    });
    assert.equal(state.status, 200);
    await page.getByLabel(`Current relay word ${state.payload.round.currentWord}`).waitFor();
    const relay = page.locator('section[class*="wordChainPanel"]');
    assert.match(await relay.evaluate(element => getComputedStyle(element, "::before").backgroundImage), /word-chain-relay-v2/);
    const commandDeck = page.locator('[class*="wordChainCommandDeck"]');
    await commandDeck.waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (index === 0) {
      const commandCanvas = page.locator('canvas[data-dzn-word-chain-canvas="true"]');
      await commandCanvas.waitFor({ state: "visible" });
      const commandDeckPixels = await sharp(await commandCanvas.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let litPixels = 0;
      const colourBuckets = new Set();
      for (let offset = 0; offset < commandDeckPixels.data.length; offset += commandDeckPixels.info.channels * 17) {
        const red = commandDeckPixels.data[offset]; const green = commandDeckPixels.data[offset + 1]; const blue = commandDeckPixels.data[offset + 2];
        if (red + green + blue > 70) litPixels++;
        colourBuckets.add(`${Math.floor(red / 24)}:${Math.floor(green / 24)}:${Math.floor(blue / 24)}`);
      }
      assert.ok(commandDeckPixels.info.width > 260 && commandDeckPixels.info.height > 180, "Word Chain should render a usable relay-command scene.");
      assert.ok(litPixels > 70, "Word Chain should retain visible relay lighting, not a black canvas.");
      assert.ok(colourBuckets.size > 18, "Word Chain should retain meaningful relay-scene detail.");
      const dictionary = ["ability", "access", "action", "active", "adapt", "eager", "early", "earth", "knife", "label", "ocean", "radio", "scale", "table"];
      const word = dictionary.find(candidate => candidate.startsWith(state.payload.round.requiredLetter));
      assert.ok(word, `QA dictionary lacks ${state.payload.round.requiredLetter}`);
      await page.getByLabel("Your word").fill(word);
      const [playResponse] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/games/word-chain") && response.request().method() === "POST"),
        page.getByRole("button", { name: "Send turn" }).click(),
      ]);
      assert.equal(playResponse.status(), 200, await playResponse.text());
      await page.getByText(word, { exact: true }).first().waitFor();
      await page.getByText("Daily relay reward earned").waitFor();
    } else {
      const commandDeckHeight = await commandDeck.evaluate(element => element.getBoundingClientRect().height);
      assert.ok(commandDeckHeight <= 410, `Word Chain phone relay deck should stay compact (received ${commandDeckHeight}px).`);
    }
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Word Chain desktop and phone rendered QA passed.");
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
