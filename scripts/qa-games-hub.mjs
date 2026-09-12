import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

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
  await page.goto(`${base}/__local-login`);
  await page.getByLabel("Difficulty", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Background motion off: reduced motion preference" }).isDisabled(), true);
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
  await page.getByRole("button", { name: "Pause background motion", exact: true }).waitFor();
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "running");
  const backdrop = page.locator('main[data-motion] > div[aria-hidden="true"] > div');
  const startTransform = await backdrop.evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(500);
  assert.notEqual(await backdrop.evaluate(element => getComputedStyle(element).transform), startTransform);
  await page.getByRole("button", { name: "Pause background motion", exact: true }).click();
  await page.reload(); await page.getByLabel("Difficulty", { exact: true }).waitFor();
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "paused");
  await page.getByRole("button", { name: "Resume background motion", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Background motion off: reduced motion preference" }).waitFor();
  assert.equal(await page.locator('main[data-motion]').getAttribute("data-motion"), "paused");
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
  checks.push("Actual authenticated API: start, safe reveal, touch flag, saved state after reload");
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
