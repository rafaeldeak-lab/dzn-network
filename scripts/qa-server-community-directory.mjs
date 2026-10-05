import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.DZN_QA_BASE_URL ?? "http://localhost:3122";
const output = "docs/qa/server-community-directory-20260930/screenshots";
await mkdir(output, { recursive: true });

const publicPayload = {
  ok: true,
  server: { public_slug: "nuketown-deathmatch", name: "NukeTown DEATHMATCH", href: "/servers/profile?slug=nuketown-deathmatch" },
  community: { name: "NukeTown Community", icon_url: null },
  members: [
    { id: "member-1", display_name: "Tara.W", role_label: "Community Leader", member_since: "2026-09-20T10:00:00.000Z", profile: { handle: "tara-w", href: "/players/tara-w", avatar_url: null } },
    { id: "member-2", display_name: "W.A.R.Lord", role_label: "Server Owner", member_since: "2026-09-21T10:00:00.000Z", profile: { handle: "war-lord", href: "/players/war-lord", avatar_url: null } },
  ],
};

const managedPayload = { ok: true, members: [
  { id: "member-1", handle: "tara-w", username: "Tara.W", role_label: "Community Leader", public_member_enabled: 1, member_approved_at: "2026-09-30T10:00:00.000Z", updated_at: "2026-09-30T10:00:00.000Z" },
  { id: "member-3", handle: "private-helper", username: "Private Helper", role_label: "Moderator", public_member_enabled: 0, member_approved_at: null, updated_at: "2026-09-30T10:00:00.000Z" },
] };
const sourcePayload = { ok: true, candidates: [
  { id: "candidate-1", candidate_discord_id_masked: "1000...0004", candidate_username: "New Survivor", role_label: "Builder", status: "pending", matched_username: "New Survivor", public_handle: "new-survivor", reason: "Exact DZN Discord account match found. Owner review is required.", can_import: true, updated_at: "2026-09-30T10:00:00.000Z" },
  { id: "candidate-2", candidate_discord_id_masked: null, candidate_username: "Unknown Player", role_label: null, status: "no_match", matched_username: null, public_handle: null, reason: "No DZN account currently matches that Discord user ID.", can_import: false, updated_at: "2026-09-30T10:00:00.000Z" },
], audit: [
  { id: "audit-1", candidate_id: "candidate-1", action: "candidate_created", result_status: "accepted", reason: "Exact DZN Discord account match found. Owner review is required.", created_at: "2026-09-30T10:00:00.000Z" },
] };

const browser = await chromium.launch({ headless: true });
for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/public/servers/*/community-members", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publicPayload) }));
  await page.goto(`${baseUrl}/servers/preview/community`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Tara.W", { exact: true }).waitFor();
  const publicResult = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, memberCards: document.querySelectorAll('a[href^="/players/"]').length }));
  if (publicResult.overflow !== 0 || publicResult.memberCards !== 2 || errors.length) throw new Error(`${name} public directory failed: ${JSON.stringify({ publicResult, errors })}`);
  await page.screenshot({ path: `${output}/${name}-public.png`, fullPage: true });

  await page.route("**/api/servers/server-qa/community-members", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(managedPayload) }));
  await page.route("**/api/servers/server-qa/community-member-candidates", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sourcePayload) }));
  await page.goto(`${baseUrl}/dashboard/community?serverId=server-qa`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Private Helper", { exact: true }).waitFor();
  await page.getByText("New Survivor", { exact: true }).waitFor();
  await page.getByLabel("Select visible").check();
  const ownerResult = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, hasPrivate: document.body.innerText.includes("PRIVATE"), hasPublic: document.body.innerText.includes("PUBLIC"), hasCandidateQueue: document.body.innerText.includes("DISCORD CANDIDATE QUEUE"), hasPlayerBoundary: document.body.innerText.toLowerCase().includes("player still decides"), hasSelectedCount: document.body.innerText.includes("1 selected") }));
  const importSelectedEnabled = await page.getByRole("button", { name: "Import selected" }).isEnabled();
  if (ownerResult.overflow !== 0 || !ownerResult.hasPrivate || !ownerResult.hasPublic || !ownerResult.hasCandidateQueue || !ownerResult.hasPlayerBoundary || !ownerResult.hasSelectedCount || !importSelectedEnabled || errors.length) throw new Error(`${name} owner directory failed: ${JSON.stringify({ ownerResult, importSelectedEnabled, errors })}`);
  await page.screenshot({ path: `${output}/${name}-owner.png`, fullPage: true });
  console.log(`${name}: ${JSON.stringify({ publicResult, ownerResult })}`);
  await page.close();
}
await browser.close();
