import { chromium } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://localhost:3120";
const guild = {
  guild_id: "111111111111111111",
  name: "Example DZN Community",
  icon: null,
  icon_url: null,
  owner: true,
  administrator: true,
  manageable: true,
  permissions: "8",
  bot_present: true,
};
const draft = {
  currentStep: 2,
  completionPercent: 29,
  discordGuildId: guild.guild_id,
  serverType: "PVE",
  serverCategory: "pve",
  tags: ["Survival"],
  publicListing: {
    public_short_description: "Example server",
    public_description: "",
    public_discord_invite: "",
    public_website_url: "",
    public_rules: "",
    public_language: "English",
    public_region_label: "Europe",
  },
  linkedServerId: null,
  nitradoServiceId: null,
  directServiceValidated: false,
  updatedAt: "2026-09-25T01:30:00.000Z",
};

const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  let cleared = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body;
    if (path === "/api/auth/me") body = { authenticated: true, user: { id: "owner", discord_id: "111", username: "Example Owner", avatar: null }, linkedServer: null, linkedServers: [] };
    else if (path === "/api/discord/guilds") body = { guilds: [guild], fresh: true };
    else if (path === "/api/onboarding/draft" && request.method() === "DELETE") {
      cleared = true;
      body = { ok: true, cleared: true };
    } else if (path === "/api/onboarding/draft" && request.method() === "PUT") {
      body = { ok: true, available: true, draft: { ...draft, ...request.postDataJSON(), updatedAt: new Date().toISOString() } };
    } else if (path === "/api/onboarding/draft") body = { ok: true, available: true, draft };
    else return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not used by onboarding QA" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`${baseUrl}/setup`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  try {
    await page.getByText("Setup 29% complete", { exact: true }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1200) }));
    throw new Error(`${name} did not resume the saved setup: ${JSON.stringify(diagnostic)}`, { cause: error });
  }
  await page.getByText("Server Type & Categories", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Restart setup", exact: true }).click();
  await page.getByText("This clears only your saved wizard answers.", { exact: false }).waitFor();
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    progress: document.querySelector('[aria-label="Setup progress"]')?.textContent ?? "",
  }));
  if (layout.overflow !== 0 || !layout.progress.includes("29%") || errors.length) {
    throw new Error(`${name} onboarding resume QA failed: ${JSON.stringify({ layout, errors })}`);
  }
  const screenshot = join(tmpdir(), `dzn-onboarding-resume-${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole("button", { name: "Confirm restart", exact: true }).click();
  await page.getByText("Setup 0% complete", { exact: true }).waitFor();
  if (!cleared) throw new Error(`${name} onboarding restart did not clear the authenticated draft`);
  console.log(`${name}: ${JSON.stringify({ ...layout, screenshot, restartCleared: cleared })}`);
  await page.close();
}
await browser.close();
