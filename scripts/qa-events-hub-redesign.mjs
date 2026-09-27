import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const origin = process.env.DZN_EVENTS_QA_ORIGIN ?? "http://127.0.0.1:3121";
const output = path.resolve("artifacts/events-hub-redesign");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    for (const reducedMotion of ["reduce", "no-preference"]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion });
      const page = await context.newPage();
      const pageErrors = [];
      const writes = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/*", (route) => {
        const request = route.request();
        if (!["GET", "HEAD"].includes(request.method())) {
          writes.push(`${request.method()} ${request.url()}`);
          return route.abort();
        }
        return route.continue();
      });

      await page.goto(`${origin}/events`, { waitUntil: "networkidle", timeout: 45_000 });
      await page.getByRole("heading", { name: "Events & Tournaments", exact: true }).waitFor();
      await page.locator("[data-featured-event]").waitFor();
      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          return box ? { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
        };
        const hero = document.querySelector("[data-events-hero]");
        return {
          viewport: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          hero: rect("[data-events-hero]"),
          featured: rect("[data-featured-event]"),
          live: rect("[data-live-events]"),
          upcoming: rect("[data-upcoming-events]"),
          stats: rect("[data-event-stats]"),
          heroImage: hero ? getComputedStyle(hero).backgroundImage : "",
        };
      });

      assert.equal(layout.overflow, false, `Events hub overflows at ${width}px`);
      assert.ok(layout.hero && layout.hero.height >= 250, `Hero is missing or collapsed at ${width}px`);
      assert.ok(layout.heroImage.includes("server-wars-banner-concept.webp"), "Hero battlefield artwork did not load");
      assert.ok(layout.featured && layout.live && layout.upcoming && layout.stats, "A primary event section is missing");
      assert.ok(layout.featured.top >= layout.hero.bottom, "Featured event must follow the hero");
      assert.ok(layout.stats.top > layout.upcoming.top, "Network totals must follow the event workspace");
      if (width < 1280) assert.ok(layout.live.top >= layout.featured.bottom - 1, "Live rail must stack below the featured event on narrow layouts");
      else assert.ok(Math.abs(layout.live.top - layout.featured.top) <= 2, "Live rail must align with the featured event on desktop");
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(writes, []);

      await page.screenshot({ path: path.join(output, `events-${width}-${reducedMotion}.png`), fullPage: true });
      results.push({ width, reducedMotion, ...layout });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
console.log(`Passed ${results.length} rendered Events Hub cases.`);
