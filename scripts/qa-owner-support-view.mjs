import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://localhost:3102";
const server = {
  id: "synthetic-support-server", serverName: "Synthetic Support Server", slug: "synthetic-support-server",
  owner: { username: "example-owner", discordId: "1111...1111" },
  guild: { guildId: "111111111111111111", discordGuildId: null, name: "Example Community" },
  nitradoServiceId: "10000000", nitradoServiceName: "Synthetic Support Server", status: "pending", listingVisibility: "public",
  lifecycleStatus: "active_live", lifecycleLabel: "Live sync active", lifecycleMessage: "Normal sync is configured", lifecycleReason: null,
  ownerActionRequired: true, ownerActionReason: "Complete account verification", syncResourceStatus: "active",
  playerCount: { current: null, max: null, status: "unknown", source: "stored", freshness: "unknown" },
  adm: { latestFile: null, latestProcessedFile: null, lastProcessedOffset: null, latestImportedEventAt: null, lastSuccessfulImportAt: null, lastAttemptedReadAt: null, status: "unknown" },
  tokenStatus: "unknown", publicProfileUrl: "/servers/synthetic-support-server", dashboardUrl: "/dashboard?server=synthetic-support-server",
  plan: { key: "free", status: "inactive" },
  billing: { paid: false, accountPresent: false, planKey: null, status: null, source: "none" },
  onboarding: { tokenRecordPresent: true, tokenSaveStatus: "saved", accountVerified: false, tokenAccessible: null, dayzServiceDetected: null, lastTestedAt: null },
  setupNotification: { websiteStatus: "opened", sentAt: "2026-09-25T01:07:04.000Z", readAt: "2026-09-25T01:20:00.000Z", openedAt: "2026-09-25T01:21:00.000Z", discordStatus: "disabled_by_owner", discordNotificationsEnabled: false },
  supportBlockers: [
    { key: "billing", severity: "attention", title: "No paid plan", detail: "No paid billing state is recorded." },
    { key: "verification", severity: "blocking", title: "Account verification pending", detail: "The owner must complete account verification." },
  ],
  stats: { totalKills: 0, totalDeaths: 0, totalJoins: 0, totalDisconnects: 0, uniquePlayers: 0, buildScore: 0, lastEventAt: null, lastBuildAt: null },
  resource: { admSyncEnabled: true, metadataRefreshEnabled: true, playerCountPollingEnabled: true, discordPostingEnabled: true, serverWarsEligible: false, consumingScheduledResources: true, excludedFromActiveSync: false, skippedReason: null },
  nextRetryAfter: null, lastSkipReason: null, badges: ["ACTIVE"], knownRole: null,
};

const lifecycle = Object.fromEntries(["active_live", "active_degraded", "token_needs_resave", "nitrado_upstream_down", "stale_monitoring", "expired_detected", "deletion_imminent", "final_sync_pending", "final_sync_complete", "legacy_offline", "archived_hidden"].map((key) => [key, key === "active_live" ? 1 : 0]));

function responseFor(path) {
  if (path === "/api/owner/overview") return { overview: { counts: { ...lifecycle, totalLinkedServers: 1, serversConsumingSyncResources: 1, serversSkippedFromSync: 0 }, featureFlags: { dznPulseEnabled: false, discordNotificationsEnabled: false, freeProAdvertisingStatus: "live" }, ownerAccess: { allowlistConfigured: true, creatorEventGovernanceConfigured: true }, knownServers: { nuketown: null, pandora: null, warlords: null }, health: { publicRoutes: null, admCycleWatch: null, autoUpdateScheduler: null }, generatedAt: new Date().toISOString() } };
  if (path === "/api/owner/servers") return { servers: [server] };
  if (path === `/api/owner/servers/${server.id}`) return { server };
  if (path === "/api/owner/audit-log") return { auditLog: { message: "No owner actions recorded yet.", phase: "phase_1_read_only", items: [] } };
  if (path === "/api/owner/discord/overview") return { overview: { integrationStatus: "not_configured", botConfigured: false, botTokenPresent: false, discordPulseDeliveryEnabled: false, discordNotificationsEnabled: false, connectedGuildCount: 0, configuredChannelCount: 0, lastPostAttempt: null, serverAnnouncements: null, postingMode: "disabled", generatedAt: new Date().toISOString() } };
  if (path.endsWith("/post-types")) return { postTypes: [] };
  if (path.endsWith("/channels")) return { channels: [] };
  if (path.endsWith("/channel-mappings")) return { mappings: [] };
  if (path.endsWith("/templates")) return { templates: [] };
  if (path.endsWith("/options")) return { options: { postTypes: [], linkedServers: [], destinationSlots: [] } };
  if (path.endsWith("/discord/audit-log")) return { auditLog: [] };
  throw new Error(`Unhandled owner QA route: ${path}`);
}

const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/owner/**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responseFor(new URL(route.request().url()).pathname)) }));
  await page.goto(`${baseUrl}/owner`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("DZN Network control state", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Servers", exact: true }).click();
  await page.getByText("All linked servers", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Support view" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText("Owner notification", { exact: true }).waitFor();
  const result = await page.evaluate(() => {
    const dialogText = document.querySelector('[role="dialog"]')?.textContent ?? "";
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, title: document.querySelector("#owner-server-support-title")?.textContent, secretText: /encrypted_token|token_iv|payment secret value/i.test(document.body.innerText), notificationStatusVisible: dialogText.includes("Opened by owner") };
  });
  if (result.overflow !== 0 || result.title !== server.serverName || result.secretText || !result.notificationStatusVisible || pageErrors.length) throw new Error(`${name} owner support QA failed: ${JSON.stringify({ result, pageErrors })}`);
  await page.screenshot({ path: join(tmpdir(), `dzn-owner-support-${name}.png`) });
  if (name === "desktop") {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  }
  console.log(`${name}: ${JSON.stringify(result)}`);
  await page.close();
}
await browser.close();
