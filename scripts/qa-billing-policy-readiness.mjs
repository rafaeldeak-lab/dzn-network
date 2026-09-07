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
  { name: "mobile", width: 390, height: 844 },
];
const results = [];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const route of routes) {
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
      if (!response?.ok()) throw new Error(`${route} returned ${response?.status() ?? "no response"}`);
      const body = await page.locator("body").innerText();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error(`${route} overflows at ${viewport.width}px`);
      if (pageErrors.length) throw new Error(`${route} page error: ${pageErrors.join("; ")}`);
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
      const name = `${viewport.name}-${route.slice(1)}`;
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      results.push({ route, viewport: viewport.name, width: viewport.width, status: response.status(), overflow, pageErrors: [] });
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(output, "results.json"), `${JSON.stringify({ baseUrl, results }, null, 2)}\n`, "utf8");
console.log(`Billing policy rendered QA passed for ${results.length} route/viewport combinations. Evidence: ${output}`);
