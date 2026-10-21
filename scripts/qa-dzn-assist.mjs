import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://localhost:3011";
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
    await page.getByLabel("Ask DZN Assist a question").fill("link stats");
    await page.getByLabel("Ask DZN Assist a question").press("Enter");
    await page.getByText("Choose the server you play on and submit the exact gamertag", { exact: false }).waitFor({ state: "visible" });
    for (const [question, reply] of [
      ["How do I set up my server?", "Start from the setup page."],
      ["How do I sign in?", "Use Discord sign-in to reach your private Player Hub."],
      ["refund policy", "Compare owner plans on Pricing."],
      ["What are the community rules?", "Global Chat is moderated."],
    ]) {
      await page.getByLabel("Ask DZN Assist a question").fill(question);
      await page.getByLabel("Ask DZN Assist a question").press("Enter");
      await page.getByText(reply, { exact: false }).last().waitFor({ state: "visible" });
    }
    await page.waitForFunction(() => {
      const transcript = document.querySelector("#dzn-assist [role='log']");
      return Boolean(transcript && (transcript.scrollHeight <= transcript.clientHeight + 1 || transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 2));
    });

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

  const homePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await homePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await homePage.getByRole("link", { name: /Chat & Help/i }).waitFor({ state: "visible" });
  await homePage.getByRole("link", { name: /Join DZN Discord/i }).waitFor({ state: "visible" });
  if (await homePage.getByLabel("Open DZN Comms").isVisible()) {
    throw new Error("phone homepage: the floating launcher must not cover the primary Discord action");
  }
  await homePage.screenshot({ path: path.join(outputDir, "phone-home-actions.png"), fullPage: false });
  await homePage.close();

  const launcherPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await launcherPage.goto(`${baseUrl}/pricing`, { waitUntil: "domcontentloaded" });
  await launcherPage.getByLabel("Open DZN Comms").click();
  await launcherPage.getByRole("link", { name: /DZN Assist/ }).waitFor({ state: "visible" });
  await launcherPage.screenshot({ path: path.join(outputDir, "phone-launcher.png"), fullPage: false });
  await launcherPage.keyboard.press("Escape");
  await launcherPage.getByRole("link", { name: /DZN Assist/ }).waitFor({ state: "hidden" });
  await launcherPage.getByLabel("Open DZN Comms").waitFor({ state: "visible" });
  await launcherPage.close();
} finally {
  await browser.close();
}

console.log(`DZN Assist rendered QA passed. Screenshots: ${outputDir}`);
