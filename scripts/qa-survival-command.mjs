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
  const terrain = await fetch(`${origin}/media/stronghold/rosebud/forest-ground.webp`);
  assert.equal(terrain.status, 200, "The Rosebud field terrain must be included in the production export.");
  assert.match(terrain.headers.get("content-type") ?? "", /^image\/webp/);
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
    await page.getByText("Daily directive", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Dispatch team/ }).click();
    await page.goto(`${origin}/__local-survival-command-ready${viewport.fixture}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Set the field order" }).waitFor();
    assert.equal(await page.getByText("Tactical command window", { exact: true }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Overwatch protocol" }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Signal intercept" }).count(), 1);
    assert.equal(await page.locator("button", { hasText: "Recovery priority" }).count(), 1);
    await page.getByRole("button", { name: /Signal intercept/ }).click();
    await page.getByText("Field decision required", { exact: true }).waitFor();
    const scene = page.locator(".dzn-survival-command-scene");
    await scene.waitFor({ state: "visible" });
    const fieldAssets = scene.locator("img");
    assert.equal(await fieldAssets.count(), 4, "Survival Command should load the four Rosebud field renders.");
    assert.equal(await fieldAssets.evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true, "Survival Command renders should load successfully.");
    const bounds = await scene.boundingBox();
    assert.ok(bounds && bounds.width > 250 && bounds.height > 190, "Survival Command should render a usable operations board.");
    assert.equal(await scene.locator('[data-selected="true"]').count(), 1, "The field board should reflect exactly one selected sector.");
    assert.ok(await page.getByText("Perimeter sweep", { exact: true }).count() >= 1, "The perimeter route should remain available.");
    assert.ok(await page.getByText("Rail-yard recovery", { exact: true }).count() >= 1, "The rail-yard route should remain available.");
    assert.ok(await page.getByText("Signal intercept", { exact: true }).count() >= 1, "The selected field order should remain visible.");
    assert.equal(await page.locator("button", { hasText: "Dispatch team" }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (viewport.name === "phone") {
      const height = await scene.evaluate(element => element.getBoundingClientRect().height);
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
