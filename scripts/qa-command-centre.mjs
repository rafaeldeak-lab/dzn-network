import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/command-centre");
await mkdir(output, { recursive: true });
const preview = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/dev-games-hub.ts"], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
});
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
    await page.goto(`${origin}/__local-command-centre`, { waitUntil: "networkidle" });
    const establish = page.getByRole("button", { name: "Establish Command Centre" });
    if (await establish.count()) await establish.click();
    await page.getByRole("heading", { name: "Ruined Camp" }).waitFor();
    const canvas = page.locator('canvas[data-dzn-command-centre-canvas="true"]');
    await canvas.waitFor({ state: "visible" });
    const telemetry = await canvas.evaluate(element => {
      const canvas = element;
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!context) return null;
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let litPixels = 0;
      const colours = new Set();
      for (let offset = 0; offset < pixels.length; offset += 4 * 17) {
        const [red, green, blue, alpha] = [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
        if (alpha > 5 && red + green + blue > 95) litPixels++;
        if (alpha > 5) colours.add(`${Math.floor(red / 20)}:${Math.floor(green / 20)}:${Math.floor(blue / 20)}`);
      }
      return { width, height, litPixels, colourCount: colours.size };
    });
    assert.ok(telemetry && telemetry.width > 240 && telemetry.height > 160, "Command Centre should render a usable 3D settlement.");
    assert.ok(telemetry.litPixels > 80, "Command Centre scene should not render blank pixels.");
    assert.ok(telemetry.colourCount > 18, "Command Centre scene should retain distinct building lighting.");
    assert.equal(await page.getByText("Headquarters", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Workshop", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Watchtower", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Comms Array", { exact: true }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Begin construction" }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (viewport.name === "phone") {
      const sceneHeight = await canvas.evaluate(element => element.parentElement?.getBoundingClientRect().height ?? 0);
      assert.ok(sceneHeight <= 300, `Command Centre phone scene should remain compact (received ${sceneHeight}px).`);
    }
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Command Centre desktop and phone rendered QA passed.");
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
