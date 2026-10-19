import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve("artifacts/survival-command");
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
  const backdrop = await fetch(`${origin}/images/games/survival-command-field-command-v2.png`);
  assert.equal(backdrop.status, 200, "The original Survival Command field-command art must be included in the production export.");
  assert.match(backdrop.headers.get("content-type") ?? "", /^image\/png/);
  for (const viewport of [{ name: "desktop", width: 1440, height: 1000, fixture: "" }, { name: "phone", width: 390, height: 844, fixture: "-other" }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/__local-survival-command${viewport.fixture}`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      await post("/api/player/command-centre", { action: "initialize" });
      await post("/api/player/survival-command", { action: "initialize" });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Sector Operations" }).waitFor();
    await page.getByText("Field loadout", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Dispatch team/ }).click();
    await page.goto(`${origin}/__local-survival-command-ready${viewport.fixture}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Set the field order" }).waitFor();
    assert.equal(await page.getByText("Tactical command window", { exact: true }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Overwatch protocol" }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Signal intercept" }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Recovery priority" }).count(), 1);
    await page.getByRole("button", { name: /Signal intercept/ }).click();
    await page.getByText("Field decision required", { exact: true }).waitFor();
    const canvas = page.locator('canvas[data-dzn-survival-command-canvas="true"]');
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
      for (let offset = 0; offset < pixels.length; offset += 4 * 19) {
        const [red, green, blue, alpha] = [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
        if (alpha > 5 && red + green + blue > 90) litPixels++;
        if (alpha > 5) colours.add(`${Math.floor(red / 20)}:${Math.floor(green / 20)}:${Math.floor(blue / 20)}`);
      }
      return { width, height, litPixels, colourCount: colours.size };
    });
    assert.ok(telemetry && telemetry.width > 250 && telemetry.height > 190, "Survival Command should render a usable operations board.");
    assert.ok(telemetry.litPixels > 110, "Survival Command scene should not render blank pixels.");
    assert.ok(telemetry.colourCount > 20, "Survival Command scene should render distinct sector lighting.");
    assert.equal(await page.getByText("Perimeter sweep", { exact: true }).count(), 2);
    assert.equal(await page.getByText("Rail-yard recovery", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Signal intercept", { exact: true }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Dispatch team" }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (viewport.name === "phone") {
      const height = await canvas.evaluate(element => element.parentElement?.getBoundingClientRect().height ?? 0);
      assert.ok(height <= 330, `Phone scene must remain compact (received ${height}px).`);
    }
    await page.screenshot({ path: path.join(output, `${viewport.name}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("DZN Survival Command desktop and phone rendered QA passed.");
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
