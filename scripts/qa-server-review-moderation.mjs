import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const output = "docs/qa/server-review-moderation-20260930";
const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://localhost:3121";
await mkdir(`${output}/screenshots`, { recursive: true });

const payload = {
  ok: true,
  reviews: [{
    id: "review-qa-12345678",
    linked_server_id: "server-qa",
    server_name: "NukeTown DEATHMATCH",
    public_slug: "nuketown-deathmatch",
    reviewer_name: "Tara.W",
    reviewer_avatar_url: null,
    rating: 4,
    title: "Fast matches and active events",
    body: "The server has quick matches, useful events, and active players. I reported one problem clearly so the moderation layout can be checked.",
    status: "pending",
    moderation_reason: null,
    moderation_version: 4,
    active_report_count: 3,
    report_reasons: "Possible harassment | Please check this review",
    first_reported_at: "2026-09-30T09:30:00.000Z",
    created_at: "2026-09-29T19:00:00.000Z",
  }],
  audit: [{
    id: "audit-qa-1",
    review_id: "older-review",
    action: "hide",
    reason: "Personal information removed after a manual check.",
    actor_name: "DZN Owner",
    created_at: "2026-09-30T08:00:00.000Z",
    server_name: "Example Server",
    reviewer_name: "Example Player",
  }],
};

const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [["desktop", 1440, 1000], ["tablet", 900, 1000], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  let apiRequests = 0;
  let postRequests = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/owner/reviews/moderate**", async (route) => {
    apiRequests += 1;
    if (route.request().method() === "POST") {
      const posted = route.request().postDataJSON();
      if (posted.moderationVersion !== 4) throw new Error(`Expected observed moderation version 4, received ${posted.moderationVersion}`);
      postRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "approved" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.goto(`${baseUrl}/owner/reviews`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByRole("heading", { name: "Review moderation" }).waitFor({ timeout: 30_000 });
  try {
    await page.getByText("Fast matches and active events", { exact: true }).first().waitFor({ timeout: 10_000 });
  } catch (error) {
    throw new Error(`${name} queue did not render: ${JSON.stringify({ apiRequests, body: (await page.locator("body").innerText()).slice(0, 1200), error: String(error) })}`);
  }
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reviewVisible: document.body.innerText.includes("Fast matches and active events"),
    actionsVisible: document.body.innerText.includes("Approve review") && document.body.innerText.includes("Hide review"),
  }));
  if (result.overflow !== 0 || !result.reviewVisible || !result.actionsVisible || errors.length) {
    throw new Error(`${name} review moderation QA failed: ${JSON.stringify({ result, errors })}`);
  }
  await page.screenshot({ path: `${output}/screenshots/${name}.png`, fullPage: true });
  if (name === "desktop") {
    await page.getByPlaceholder("Required for the permanent audit record").fill("Reports reviewed against the public safety rules.");
    await page.getByRole("button", { name: "Approve review" }).click();
    await page.getByText("Review approved and restored to the public score.", { exact: true }).waitFor({ timeout: 10_000 });
    if (postRequests !== 1) throw new Error(`desktop review moderation action expected one POST, received ${postRequests}`);
  }
  console.log(`${name}: ${JSON.stringify(result)}`);
  await page.close();
}
await browser.close();
