import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const output = "docs/qa/dzn-comms-owner-moderation-20260924";
const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://127.0.0.1:3120";
await mkdir(`${output}/screenshots`, { recursive: true });

const payload = {
  ok: true,
  source: "dzn_comms_owner_moderation",
  reports: [{
    message_id: "message-qa-1",
    author_display_name: "DZN Player",
    body: "Example reported message for the private moderation workspace.",
    visibility_state: "visible",
    created_at: "2026-09-24 10:00:00",
    expires_at: "2026-10-24T10:00:00.000Z",
    report_count: 2,
    first_reported_at: "2026-09-24 10:05:00",
    reasons: "harassment,spam",
  }],
  audit: [{ id: "audit-qa-1", message_id: "older-message", action: "hide", reason_code: "Safety review", created_at: "2026-09-24 09:00:00", actor_name: "DZN Owner" }],
  retention: { message_days: 30, deleted_body_erasure: true },
};

const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 900, 1000], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/owner/comms/moderate", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "MODERATION_RECORDED" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto(`${baseUrl}/owner/comms`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Global Chat moderation" }).waitFor();
  const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, title: document.title }));
  if (result.overflow !== 0 || errors.length) throw new Error(`${name} moderation QA failed: ${JSON.stringify({ result, errors })}`);
  await page.screenshot({ path: `${output}/screenshots/${name}.png`, fullPage: true });
  console.log(`${name}: ${JSON.stringify(result)}`);
  await page.close();
}
await browser.close();
