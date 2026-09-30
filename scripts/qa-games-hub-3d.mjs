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

try {
  for (const scenario of [
    { width: 1440, height: 1000, reducedMotion: "no-preference" },
    { width: 390, height: 844, reducedMotion: "no-preference" },
    { width: 390, height: 844, reducedMotion: "reduce" },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, reducedMotion: scenario.reducedMotion });
    const page = await context.newPage();
    const errors = [], failed = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    page.on("request", request => { if (request.method() !== "GET" && request.method() !== "HEAD") writes.push({ url: request.url(), method: request.method(), body: request.postDataJSON?.() }); });

    await page.goto(`${origin}/__local-login`, { waitUntil: "networkidle" });
    const canvas = page.locator('canvas[data-dzn-minefield-canvas="true"]');
    if (await canvas.count() === 0) await page.getByRole("button", { name: "Start mission" }).click();
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
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      field: document.querySelector(".dzn-minefield-3d")?.getBoundingClientRect().toJSON(),
      main: document.querySelector("main")?.getBoundingClientRect().toJSON(),
      motion: document.querySelector("main")?.getAttribute("data-motion"),
    }));

    assert.equal(layout.overflow, false, `Games Hub overflow at ${scenario.width}px`);
    assert.ok(canvasState.width >= 300 && canvasState.height >= 300, JSON.stringify(canvasState));
    assert.ok(canvasState.litPixels > 3000, `Canvas must contain rendered pixels: ${JSON.stringify(canvasState)}`);
    assert.ok(canvasState.distinct > 18, `Canvas must contain a real colour range: ${JSON.stringify(canvasState)}`);
    assert.ok(layout.field.width <= layout.main.width + 1, "3D field must stay inside the page");
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
      await canvas.click({ position: { x: Math.round((await canvas.evaluate(element => element.clientWidth)) / 2), y: Math.round((await canvas.evaluate(element => element.clientHeight)) / 2) } });
      await page.waitForFunction(previous => document.querySelector(".dzn-minefield-3d")?.getAttribute("data-game-version") !== previous, version);
      const move = writes.map(entry => entry.body).find(body => body?.action === "move");
      assert.deepEqual(Object.keys(move).sort(), ["action", "gameId", "tool", "version", "x", "y"], "3D interaction must use the existing bounded move contract");
      assert.equal(move.tool, "reveal");
      await page.getByRole("button", { name: /Tactical grid/i }).click();
      await page.getByRole("group", { name: /Minesweeper board/i }).waitFor();
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    await page.screenshot({ path: path.join(output, `games-${scenario.width}-${scenario.reducedMotion}.png`), fullPage: true });
    results.push({ ...scenario, before, after, canvasState, layout, writes: writes.map(entry => ({ method: entry.method, path: new URL(entry.url).pathname, action: entry.body?.action })) });
    await context.close();
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
