import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const playwrightPath = process.env.DZN_QA_PLAYWRIGHT_PATH;
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : "playwright");
const baseUrl = process.env.DZN_BILLING_POLICY_QA_URL ?? "http://127.0.0.1:3094";
const output = process.env.DZN_BILLING_POLICY_QA_OUTPUT ?? path.join(process.cwd(), "tmp", "qa-billing-policy-readiness");
const routes = ["/pricing", "/terms", "/privacy", "/refunds"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mid-width", width: 900, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "small-mobile", width: 320, height: 780 },
];
const results = [];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.DZN_QA_BROWSER_CHANNEL ? { channel: process.env.DZN_QA_BROWSER_CHANNEL } : {}) });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: viewport.width <= 390 ? "reduce" : "no-preference" });
    const page = await context.newPage();
    for (const route of routes) {
      const pageErrors = [];
      const recordPageError = (error) => pageErrors.push(error.message);
      page.on("pageerror", recordPageError);
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      if (!response?.ok()) throw new Error(`${route} returned ${response?.status() ?? "no response"}`);
      await page.locator("main").waitFor({ state: "visible" });
      const body = await page.locator("body").innerText();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error(`${route} overflows at ${viewport.width}px`);
      if (pageErrors.length) throw new Error(`${route} page error: ${pageErrors.join("; ")}`);
      const contact = page.getByRole("region", { name: "DZN Network contact", exact: true });
      const contactText = await contact.innerText();
      for (const text of ["DZN Network", "Suite RA01, 195-197 Wood Street", "London", "E17 3NU", "United Kingdom", "dznnetworksupport@gmail.com"]) {
        if (!contactText.includes(text)) throw new Error(`${route} is missing approved public contact: ${text}`);
      }
      if (await contact.locator('a[href="mailto:dznnetworksupport@gmail.com"]').count() !== 1) throw new Error(`${route} has an incorrect support email link`);
      const html = await page.content();
      if (/QA_PRIVATE_SELLER_DO_NOT_PUBLISH|QA_PRIVATE_ADDRESS_DO_NOT_PUBLISH|href="tel:/i.test(html)) throw new Error(`${route} exposes a private identity fixture or phone link`);
      if (route === "/pricing") {
        for (const text of ["Eligible accounts: £0 for a 2-day trial, then £2/month", "Pro has no free trial", "Cancellations and refunds"]) {
          if (!body.includes(text)) throw new Error(`/pricing is missing: ${text}`);
        }
      } else {
        for (const href of ["/terms", "/privacy", "/refunds", "/pricing"]) {
          if (await page.locator(`a[href="${href}"]`).count() === 0) throw new Error(`${route} is missing ${href}`);
        }
        if (!body.includes("dznnetworksupport@gmail.com")) throw new Error(`${route} is missing private support contact`);
      }
      if (route === "/terms") {
        if (!body.includes("Rafael Deak trading as DZN Network") || !body.includes("individual operating as a sole trader") ||
            !body.includes("Current plans and checkout availability")) {
          throw new Error("/terms must publish the approved seller and use current pricing for availability");
        }
        if (body.includes("Live subscription checkout remains unavailable")) throw new Error("/terms freezes stale checkout availability");
      } else if (body.includes("Rafael Deak")) {
        throw new Error(`${route} must retain DZN branding without republishing the legal name`);
      }
      const name = `${viewport.name}-${route.slice(1)}`;
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      await contact.screenshot({ path: path.join(output, `${name}-contact.png`) });
      results.push({ route, viewport: viewport.name, width: viewport.width, status: response.status(), overflow, pageErrors: [] });
      page.off("pageerror", recordPageError);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(output, "results.json"), `${JSON.stringify({ baseUrl, results }, null, 2)}\n`, "utf8");
console.log(`Billing policy rendered QA passed for ${results.length} route/viewport combinations. Evidence: ${output}`);
