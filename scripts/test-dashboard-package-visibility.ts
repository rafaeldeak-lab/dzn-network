import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
const policySource = readFileSync("docs/PUBLIC_ACCESS_POLICY.md", "utf8");

const packageGuideBlock = sourceBlock(dashboardSource, "function DashboardPackageGuide", "function renderDashboardTabAccessBadge");
const packageHelperBlock = sourceBlock(dashboardSource, "function getDashboardPackageVisibility", "function inferDashboardReputationTier");
const tabItemsBlock = sourceBlock(dashboardSource, "const tabItems: Array", "const nitradoLogSettingsComplete");
const advertisingBoostBlock = sourceBlock(dashboardSource, "function AdvertisingBoostPanel", "function DiscordAutoPostsPanel");

assert.equal(
  dashboardSource.includes("navigation={auth.navigation ?? null}"),
  true,
  "Dashboard must pass the read-only auth navigation summary into the package-aware server dashboard.",
);
assert.equal(
  dashboardSource.includes("navigation: AuthResponse[\"navigation\"] | null;"),
  true,
  "ServerDashboard props must explicitly carry auth navigation state.",
);
assert.equal(
  dashboardSource.includes("const dashboardPackage = getDashboardPackageVisibility({"),
  true,
  "Dashboard must derive one package visibility state for the sidebar and tabs.",
);

for (const expected of [
  "type DashboardPackageTier = \"free\" | \"starter\" | \"pro\";",
  "type DashboardTabAccess = \"trial_safe\" | \"mixed_pro\" | \"pro_tools\" | \"account\";",
  "DashboardPackageGuide",
  "renderDashboardTabAccessBadge(item.access, dashboardPackage.tier)",
]) {
  assert.equal(dashboardSource.includes(expected), true, `Dashboard package visibility must include: ${expected}`);
}

for (const expected of [
  "Starter trial workspace",
  "Starter workspace",
  "Pro tools active",
  "Start with Starter",
  "Trial-safe tools stay visible",
  "Locked areas explain what Pro adds before checkout starts.",
  "Pro-only dashboard areas stay presented as upgrade previews",
]) {
  assert.equal(packageHelperBlock.includes(expected), true, `Package helper must keep copy for: ${expected}`);
}

for (const legacyPlan of ["premium", "network", "partner"]) {
  assert.equal(packageHelperBlock.includes(`normalized === \"${legacyPlan}\"`), true, `${legacyPlan} must continue to display as effective Pro.`);
}
for (const badStatus of ["past_due", "canceled", "unpaid", "incomplete_expired"]) {
  assert.equal(packageHelperBlock.includes(`\"${badStatus}\"`), true, `${badStatus} must not display as unlocked Pro.`);
}

for (const expected of [
  "Pro locks do not affect leaderboard rank, K/D, score, badges, crowns, event outcomes, or gameplay results.",
  "Pro upgrade path",
  "Compare Pro",
  "Open Pro tools",
]) {
  assert.equal(packageGuideBlock.includes(expected), true, `Package guide must include: ${expected}`);
}
assert.equal(packageGuideBlock.includes("createCheckoutSession"), false, "The package guide must not start Stripe checkout directly.");
assert.equal(packageGuideBlock.includes("createPortalSession"), false, "The package guide must not open Stripe portal directly.");

assert.equal(dashboardSource.includes('if (value === "starter") return "Starter Listing";'), true, "Starter dashboard labels must not fall through to Free Listing.");
assert.equal(
  advertisingBoostBlock.includes("dashboardPackageTierFromPlanKey(billing?.plan_key ?? null, billing?.plan_status ?? null)"),
  true,
  "Advertising fallback copy must classify Pro by effective package tier, not by billing status alone.",
);
assert.equal(
  advertisingBoostBlock.includes('billing?.plan_status === "active" || billing?.plan_status === "trialing"'),
  false,
  "Starter active/trialing accounts must not be displayed as Pro Listing in advertising fallback UI.",
);
assert.equal(
  advertisingBoostBlock.includes("Free and Starter listings can be bumped once every 30 days."),
  true,
  "Advertising fallback copy must keep Starter on 30-day bump wording until Pro is confirmed.",
);

for (const expected of [
  "Overview",
  "Live status, setup checks, and trial-safe stats.",
  "Events",
  "Eligible events show here; Pro-only entries stay locked.",
  "Billing & Boosts",
  "Compare Starter and Pro without changing live Stripe settings.",
  "Discord Posts",
  "Starter posts stay available; Pro embeds are marked.",
]) {
  assert.equal(tabItemsBlock.includes(expected), true, `Dashboard tabs must include package-aware copy: ${expected}`);
}
assert.match(tabItemsBlock, /key: \"events\"[\s\S]*access: \"mixed_pro\"/);
assert.match(tabItemsBlock, /key: \"discord-posts\"[\s\S]*access: \"mixed_pro\"/);
assert.match(tabItemsBlock, /key: \"billing\"[\s\S]*access: \"account\"/);

for (const expectedPolicy of [
  "Dashboard package visibility must follow the same split.",
  "Starter/trial users may see the normal setup, public listing, basic stats, events, billing comparison, and basic Discord posting surfaces",
  "Pro-effective users may see those tools as active, while server-side entitlement checks remain authoritative.",
  "Package copy must not imply a competitive advantage.",
  "The dashboard sidebar shows package-aware guidance",
]) {
  assert.equal(policySource.includes(expectedPolicy), true, `Public access policy must document: ${expectedPolicy}`);
}

console.log("Dashboard package visibility tests passed.");

function sourceBlock(source: string, startNeedle: string, endNeedle: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source block end: ${endNeedle}`);
  return source.slice(start, end);
}
