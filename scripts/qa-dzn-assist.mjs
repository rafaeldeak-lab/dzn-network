import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://127.0.0.1:3011";
const outputDir = path.resolve("artifacts/dzn-assist-qa");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}/community#dzn-assist`, { waitUntil: "domcontentloaded" });
    const assist = page.locator("#dzn-assist");
    await assist.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const rect = document.querySelector("#dzn-assist")?.getBoundingClientRect();
      return Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0);
    });
    await page.locator("#dzn-assist-search").fill("server setup");
    await page.getByRole("heading", { name: "Add or resume a server setup" }).waitFor({ state: "visible" });

    const layout = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      assistTop: document.querySelector("#dzn-assist")?.getBoundingClientRect().top ?? -1,
    }));
    if (layout.bodyWidth > layout.viewportWidth + 1) throw new Error(`${viewport.name}: horizontal overflow (${layout.bodyWidth} > ${layout.viewportWidth})`);
    if (layout.assistTop >= viewport.height || layout.assistTop < -100) throw new Error(`${viewport.name}: direct anchor did not place DZN Assist in view`);

    await page.screenshot({ path: path.join(outputDir, `${viewport.name}-assist.png`), fullPage: true });
    await page.close();
  }

  const launcherPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await launcherPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await launcherPage.getByRole("button", { name: "Open DZN Comms" }).click();
  await launcherPage.getByRole("link", { name: /DZN Assist Guided help live/ }).waitFor({ state: "visible" });
  await launcherPage.screenshot({ path: path.join(outputDir, "phone-launcher.png"), fullPage: false });
  await launcherPage.close();
} finally {
  await browser.close();
}

console.log(`DZN Assist rendered QA passed. Screenshots: ${outputDir}`);
