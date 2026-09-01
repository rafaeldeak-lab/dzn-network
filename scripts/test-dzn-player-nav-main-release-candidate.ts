import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const playerPageSource = readFileSync("app/player/page.tsx", "utf8");
const playerProfilePageSource = readFileSync("app/player/profile/page.tsx", "utf8");
const playerHomeSource = readFileSync("components/player/player-home.tsx", "utf8");
const siteHeaderSource = readFileSync("components/site-header.tsx", "utf8");
const middlewareSource = readFileSync("functions/_middleware.ts", "utf8");
const routesPatchSource = readFileSync("scripts/patch-pages-routes.mjs", "utf8");
const publicAccessPolicyDoc = readFileSync("docs/PUBLIC_ACCESS_POLICY.md", "utf8");
const authMeSource = readFileSync("functions/api/auth/me.ts", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const globalsSource = readFileSync("app/globals.css", "utf8");

for (const path of ["app/player/page.tsx", "app/player/profile/page.tsx", "components/player/player-home.tsx"]) {
  assert.equal(existsSync(path), true, `${path} must exist.`);
}

assert.equal(playerPageSource.includes("<PlayerHome mode=\"home\" />"), true);
assert.equal(playerProfilePageSource.includes("<PlayerHome mode=\"profile\" />"), true);
assert.equal(playerHomeSource.includes("fetch(\"/api/auth/me\", { cache: \"no-store\", credentials: \"include\" })"), true);
assert.equal(playerHomeSource.includes("<SiteHeaderAuthState"), true);
assert.equal(playerHomeSource.includes("returnTo={returnTo}"), true);
assert.equal(playerHomeSource.includes("Login With Discord"), true);
assert.equal(playerHomeSource.includes("/login?returnTo="), true);
assert.equal(playerHomeSource.includes("Free Player Access"), true);
assert.equal(playerHomeSource.includes("Discord Login"), true);
assert.equal(playerHomeSource.includes("Player flow"), true);
assert.equal(playerHomeSource.includes("Owner flow"), true);
assert.equal(playerHomeSource.includes("/pricing?intent=owner_setup&returnTo=%2Fsetup"), true);
assert.equal(playerHomeSource.includes("/media/dzn-cinematic-survivor.png"), true);

const loggedOutHeaderBlock = sourceBlock(siteHeaderSource, "const loggedOutHeaderLinks", "const starterHeaderLinks");
const starterHeaderBlock = sourceBlock(siteHeaderSource, "const starterHeaderLinks", "const proHeaderLinks");
const proHeaderBlock = sourceBlock(siteHeaderSource, "const proHeaderLinks", "let pageHeaderAuthState");

assert.equal(siteHeaderSource.includes("type SiteHeaderActive = \"features\" | \"player\""), true);
assert.equal(siteHeaderSource.includes("if (pathname.startsWith(\"/player\")) return \"player\";"), true);
assert.equal(loggedOutHeaderBlock.includes("Player Hub"), false, "Logged-out header must not advertise private player pages.");
assert.equal(starterHeaderBlock.includes("{ href: \"/player\", label: \"Player Hub\", active: \"player\" }"), true);
assert.equal(proHeaderBlock.includes("{ href: \"/player\", label: \"Player Hub\", active: \"player\" }"), true);

assert.equal(middlewareSource.includes("\"/player\""), true, "Player pages must be protected by the page middleware.");
assert.equal(routesPatchSource.includes("\"/player\""), true, "Exact player route must be included in Pages functions routing.");
assert.equal(routesPatchSource.includes("\"/player/*\""), true, "Nested player routes must be included in Pages functions routing.");
assert.equal(publicAccessPolicyDoc.includes("`/player`"), true);
assert.equal(publicAccessPolicyDoc.includes("`/player/profile`"), true);
assert.equal(publicAccessPolicyDoc.includes("including the personal Player Hub"), true);
assert.equal(globalsSource.includes("@media (max-width: 1400px)"), true, "Header must wrap early enough to fit the logged-in Player Hub nav.");

for (const forbidden of [
  "DZN_LIVE_CHECKOUT_ENABLED=true",
  "checkout.sessions.create",
  "store_orders",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "new DurableObject",
  "WebSocket",
  "analytics",
  "trackEvent",
]) {
  assert.equal(playerHomeSource.includes(forbidden), false, `Player nav slice must not introduce ${forbidden}.`);
}

const approvedRefreshStart = playerHomeSource.indexOf("async function refreshCommunityMatches");
const approvedRefreshEnd = playerHomeSource.indexOf("const profileHandlePreview", approvedRefreshStart);
assert.notEqual(approvedRefreshStart, -1, "Approved player Discord membership refresh action must remain findable.");
assert.notEqual(approvedRefreshEnd, -1, "Approved player Discord membership refresh action must have a stable end marker.");
const approvedRefreshSource = playerHomeSource.slice(approvedRefreshStart, approvedRefreshEnd);
const playerHomeWithoutApprovedRefresh = `${playerHomeSource.slice(0, approvedRefreshStart)}${playerHomeSource.slice(approvedRefreshEnd)}`;
assert.equal(approvedRefreshSource.includes("fetch(\"/api/player/community-memberships/refresh\""), true, "Player page may only send the approved private membership refresh.");
assert.equal(approvedRefreshSource.includes("method: \"POST\""), true, "Approved private membership refresh must use POST.");
assert.equal(/fetch\([^)]*,\s*\{[\s\S]*method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i.test(playerHomeWithoutApprovedRefresh), false, "Player page must not send unapproved mutations.");
assert.equal(/\b(?:INSERT|UPDATE|DELETE FROM|DROP TABLE|ALTER TABLE)\b/i.test(playerHomeSource), false, "Player UI must not contain mutation SQL.");
assert.equal(authMeSource.includes("getOwnerBillingStatus"), false, "Auth summary must remain read-only.");
assert.equal(authMeSource.includes("ensureBillingSchema"), false, "Auth summary must not create billing schema during player/header probes.");
assert.equal(authMeSource.includes("upsertOwnerEntitlements"), false, "Auth summary must not upsert billing entitlements during player/header probes.");

for (const competitiveSource of [
  "functions/api/public/leaderboards.ts",
  "functions/api/public/server-leaderboard.ts",
  "functions/_lib/public-leaderboards.ts",
  "functions/_lib/server-war-scoring.ts",
]) {
  const source = readFileSync(competitiveSource, "utf8");
  assert.equal(source.includes("/player"), false, `${competitiveSource} must not depend on personal player routes.`);
}

assert.equal(packageSource.includes("\"test:dzn-player-nav-main-release-candidate\""), true);

console.log("DZN player nav main release candidate tests passed.");

function sourceBlock(source: string, startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}
