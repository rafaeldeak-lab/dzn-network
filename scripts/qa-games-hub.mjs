import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const base = process.env.GAMES_PREVIEW_URL;
if (!base || new URL(base).hostname !== "127.0.0.1") throw new Error("Set GAMES_PREVIEW_URL to the loopback-only synthetic preview.");
const output = process.env.GAMES_QA_OUTPUT ?? "output/games-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [], pageErrors = [], checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 400 && !response.url().includes("/api/")) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}/games`);
  await page.getByRole("link", { name: "Sign in with Discord", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Start mission" }).count(), 0);
  await page.screenshot({ path: `${output}/anonymous.png`, fullPage: true });
  checks.push("Anonymous route gates games and rewards behind Discord login");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('main[data-motion="running"]').waitFor();
  await page.getByText("Display", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).uncheck();
  await page.locator('main[data-motion="paused"]').waitFor();
  await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  checks.push("Signed-out visitors can stop scenery without a game, account or header pause button");
  await page.goto(`${base}/__local-login`);
  await page.getByLabel("Difficulty", { exact: true }).waitFor();
  const homeLink = page.getByRole("link", { name: "DZN Network home", exact: true });
  assert.equal(await homeLink.getAttribute("href"), "/");
  await homeLink.locator("img").evaluate(image => image.decode());
  assert.equal(await homeLink.locator("video").count(), 0);
  assert.equal(await page.getByRole("navigation", { name: "DZN Network", exact: true }).getByRole("button").count(), 0);
  await page.getByText("Display", { exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: /Animated scenery/ }).isDisabled(), true);
  await page.getByText("Display", { exact: true }).click();
  checks.push("Header has no pause button; reduced-motion preference remains accessible in Display");
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "paused");
  const scanner = page.getByAltText("DZN field scanner, survey flags and equipment bag");
  if (await scanner.count()) {
    await scanner.evaluate(image => image.decode());
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${output}/art-ready-${width}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('main[data-motion="running"]').waitFor();
  await homeLink.locator("video").waitFor();
  await page.waitForFunction(() => document.querySelector('.dzn-header-logo video')?.readyState >= 2);
  const logoTime = await homeLink.locator("video").evaluate(video => video.currentTime);
  await page.waitForTimeout(400);
  assert.notEqual(await homeLink.locator("video").evaluate(video => video.currentTime), logoTime);
  assert.ok(await homeLink.locator("video").evaluate(video => video.muted && video.loop && video.playsInline));
  checks.push("Existing V2 animated DZN homepage button loads and plays, with reduced-motion poster fallback");
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "running");
  const backdrop = page.locator('[data-outpost="scene"]');
  const startTransform = await backdrop.evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(500);
  assert.notEqual(await backdrop.evaluate(element => getComputedStyle(element).transform), startTransform);
  const rain = page.locator('[data-outpost="rain"]').first();
  const rainTransform = await rain.evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(250);
  assert.notEqual(await rain.evaluate(element => getComputedStyle(element).transform), rainTransform);
  // Freeze the camera and hide foreground text to measure scene effects, not UI timers.
  const sceneStyle = '[data-outpost="scene"] { animation-play-state: paused !important; } [data-outpost="environment"] + div { visibility: hidden; }';
  async function captureScene() {
    await page.evaluate(() => window.scrollTo(0, 0));
    const top = await page.locator('main[data-motion]').evaluate(element => element.getBoundingClientRect().top);
    return page.screenshot({ clip: { x: 0, y: Math.max(0, top), width: page.viewportSize().width, height: 320 }, style: sceneStyle });
  }
  async function changedPixels(first, second) {
    const a = await sharp(first).removeAlpha().raw().toBuffer();
    const b = await sharp(second).removeAlpha().raw().toBuffer();
    assert.equal(a.length, b.length);
    let changed = 0;
    for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) changed++;
    return changed;
  }
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const firstFrame = await captureScene();
    await page.waitForTimeout(450);
    const secondFrame = await captureScene();
    assert.ok(await changedPixels(firstFrame, secondFrame) > 150, `Independent outpost effects must visibly move at ${width}px`);
    await writeFile(`${output}/live-scene-${width}-a.png`, firstFrame);
    await writeFile(`${output}/live-scene-${width}-b.png`, secondFrame);
    await page.screenshot({ path: `${output}/live-layout-${width}.png`, fullPage: true });
  }
  checks.push("Rain and equipment move independently of the camera, with changed-pixel proof at desktop, tablet and both phone widths");
  await page.getByText("Display", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).uncheck();
  await page.getByText("Display", { exact: true }).click();
  await page.waitForTimeout(100);
  const pausedFrame = await captureScene(); await page.waitForTimeout(450);
  assert.equal(await changedPixels(pausedFrame, await captureScene()), 0);
  assert.ok(await backdrop.evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState === "paused")));
  await page.reload(); await page.getByLabel("Difficulty", { exact: true }).waitFor();
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "paused");
  await page.getByText("Display", { exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).isChecked(), false);
  await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).check();
  await page.getByText("Display", { exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.locator('main[data-motion="paused"]').waitFor();
  assert.ok(await backdrop.evaluate(element => element.getAnimations({ subtree: true }).every(animation => animation.playState === "paused")));
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
  await page.locator('main[data-motion="running"]').waitFor();
  checks.push("Pause freezes every effect and survives reload; simulated hidden-tab lifecycle suspends and resumes motion without changing preference");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('main[data-motion="paused"]').waitFor();
  assert.equal(await homeLink.locator("video").count(), 0);
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "paused");
  assert.equal(await backdrop.evaluate(element => element.getAnimations({ subtree: true }).length), 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push("Custom equipment artwork, moving backdrop, persistent pause and live reduced-motion preference");
  await page.getByLabel("Difficulty", { exact: true }).selectOption("recon");
  if (await page.getByRole("button", { name: "Start mission", exact: true }).count()) {
    await page.getByRole("button", { name: "Start mission", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "New board", exact: true }).click();
    if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "New board" }).click();
  }
  await page.getByRole("group", { name: "Recon Minesweeper board" }).waitFor();
  const before = await (await context.request.get(`${base}/api/games/hub`)).json();
  assert.equal(before.game.cells.flat().every(cell => cell === "hidden"), true);
  await page.getByRole("button", { name: "Row 1, column 1: Unrevealed", exact: true }).click();
  await page.getByRole("button", { name: /Row 1, column 1: [0-8] nearby mines/ }).waitFor();
  const hidden = page.locator('button[data-state="hidden"]').last();
  await page.getByRole("button", { name: "Place or remove flag", exact: true }).click();
  await hidden.click();
  await page.locator('button[data-state="flag"]').waitFor();
  const saved = await (await context.request.get(`${base}/api/games/hub`)).json();
  await page.reload();
  await page.locator('button[data-state="flag"]').waitFor();
  const resumed = await (await context.request.get(`${base}/api/games/hub`)).json();
  assert.deepEqual(resumed.game, saved.game);
  await homeLink.click();
  await page.waitForURL(`${base}/`);
  await page.getByRole("link", { name: "DZN Network home", exact: true }).waitFor();
  await page.goBack();
  await page.locator('button[data-state="flag"]').waitFor();
  assert.deepEqual((await (await context.request.get(`${base}/api/games/hub`)).json()).game, saved.game);
  checks.push("DZN logo navigates home and browser Back restores the saved mission");
  checks.push("Actual authenticated API: start, safe reveal, touch flag, saved state after reload");
  const chassis = page.locator('[data-field-board="dzn"]');
  await chassis.getByAltText("DZN Network", { exact: true }).evaluate(image => image.decode());
  assert.equal(await chassis.getByText("FIELD OPERATIONS", { exact: true }).count(), 1);
  const hiddenCell = page.locator('button[data-state="hidden"]').first();
  const dimensions = await hiddenCell.boundingBox();
  await hiddenCell.hover(); await hiddenCell.focus();
  assert.deepEqual(await hiddenCell.boundingBox(), dimensions);
  const stateStyles = await page.locator('button[data-state]').evaluateAll(cells => Object.fromEntries(cells.map(cell => [cell.dataset.state, getComputedStyle(cell).backgroundColor])));
  assert.notEqual(stateStyles.open, stateStyles.hidden);
  assert.notEqual(stateStyles.flag, stateStyles.hidden);
  assert.notEqual(stateStyles.flag, stateStyles.open);
  checks.push("DZN field chassis and logo render; revealed, covered and flagged cells are distinct with no hover/focus layout shift");
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Keep playing" }).click();
  assert.equal((await (await context.request.get(`${base}/api/games/hub`)).json()).game.id, before.game.id);
  checks.push("New board confirmation can be cancelled without losing progress");
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  const first = page.locator('button[data-index="0"]'); await first.focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-index")), "1");
  checks.push("Keyboard cell navigation, rules dialog and Escape dismissal");
  for (const [label, width, height] of [["desktop", 1440, 1000], ["tablet", 900, 1000], ["mobile", 390, 844], ["small-phone", 320, 780]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${output}/${label}-play.png`, fullPage: true });
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(overflow.scroll <= overflow.client + 1, `${label} page overflow: ${JSON.stringify(overflow)}`);
    const cellBox = await first.boundingBox();
    assert.ok(cellBox.width >= 24 && cellBox.height >= 24, `${label}: cells retain at least 24px touch targets`);
    checks.push(`${label}: board rendered without page-level horizontal overflow`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Insignia", exact: true }).click();
  await page.getByRole("heading", { name: "Field insignia" }).waitFor();
  await page.screenshot({ path: `${output}/mobile-insignia.png`, fullPage: true });
  await page.reload(); await page.getByRole("heading", { name: "Field insignia" }).waitFor();
  await page.getByRole("link", { name: "Workshop", exact: true }).click();
  await page.getByRole("heading", { name: "Field relay workshop" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Assemble Power unit/ }).isDisabled(), true);
  await page.screenshot({ path: `${output}/mobile-workshop.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${output}/desktop-workshop.png`, fullPage: true });
  checks.push("Workshop correctly requires earned parts; view persists after reload");
  await page.getByRole("link", { name: "Play", exact: true }).click();
  await page.getByLabel("Difficulty", { exact: true }).selectOption("survival");
  await page.getByRole("button", { name: "New board", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "New board" }).click();
  await page.getByRole("group", { name: "Survival Minesweeper board" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile-survival.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks.push("20x20 board scrolls inside the board, not the entire phone page");
  for (const asset of ["field-insignia.png", "field-relay.png", "dzn-outpost.webp", "dzn-field-scanner.webp"]) {
    const image = await context.request.get(`${base}/images/games/${asset}`); assert.equal(image.status(), 200); assert.ok((await image.body()).length > 1000);
  }
  for (const route of ["player/__next.player.__PAGE__.txt", "login/__next.login.__PAGE__.txt"]) {
    assert.equal((await context.request.get(`${base}/${route}`)).status(), 200);
  }
  checks.push("Windows nested segment-prefetch files resolve to actual exported bytes");
  await page.route("**/api/games/hub", route => route.abort());
  await page.reload(); await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByText("Display", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).uncheck();
  await page.locator('main[data-motion="paused"]').waitFor();
  await page.getByRole("checkbox", { name: "Animated scenery", exact: true }).check();
  await page.getByText("Display", { exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  checks.push("Unavailable screen keeps Display accessible and scenery controllable");
  await page.screenshot({ path: `${output}/offline.png`, fullPage: true });
  await page.unroute("**/api/games/hub"); await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("group", { name: "Survival Minesweeper board" }).waitFor();
  checks.push("Disconnected read has an honest retry state and restores saved board");
  await page.addInitScript(() => { const original = Date.now; Date.now = () => original() + 3600000; });
  await page.reload();
  await page.getByRole("group", { name: "Survival Minesweeper board" }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('[data-index="0"]').getAttribute("aria-disabled"), "false");
  assert.equal(await page.getByText("Mission expired", { exact: true }).count(), 0);
  checks.push("Incorrect phone clock cannot expire a valid server-timed board");
  const headerPage = await context.newPage();
  for (const tier of ["free", "pro"]) {
    await headerPage.route("**/api/auth/me", route => route.fulfill({ json: { authenticated: true,
      user: { id: "local", username: "Local QA", discord_id: "1000001" }, navigation: { plan_tier: tier, plan_label: tier,
        plan_status: "active", linked_server_count: 1, linked_server_limit: 1, primary_action: { label: "Dashboard", href: "/dashboard", tone: "pro" } } } }));
    await headerPage.goto(base);
    await headerPage.getByRole("link", { name: "Games", exact: true }).waitFor();
    await headerPage.evaluate(() => document.fonts.ready);
    for (const width of [1920, 1440, 1280, 900, 390]) {
      await headerPage.setViewportSize({ width, height: 900 });
      const clipped = await headerPage.locator(".dzn-header-links a").evaluateAll(links => links.flatMap(link => {
        const label = link.querySelector("span"), a = link.getBoundingClientRect(), s = label.getBoundingClientRect();
        return s.left < a.left - 1 || s.right > a.right + 1 ? [label.textContent] : [];
      }));
      assert.deepEqual(clipped, [], `${tier} header at ${width}px clips labels`);
    }
    await headerPage.setViewportSize({ width: 1440, height: 900 });
    await headerPage.locator(".dzn-header-shell").screenshot({ path: `${output}/header-${tier}.png` });
    await headerPage.unroute("**/api/auth/me");
  }
  await headerPage.close();
  checks.push("Free and Pro navigation labels fit at 1920, 1440, 1280, 900 and 390px with Games added");
  assert.deepEqual(pageErrors, []); assert.deepEqual(failures, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ base, synthetic: true, productionTouched: false, checks, pageErrors, failures }, null, 2));
  console.log(JSON.stringify({ checks, pageErrors, failures }, null, 2));
} finally { await browser.close(); }
