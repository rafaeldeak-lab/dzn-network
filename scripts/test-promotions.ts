import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getBillingPlanSummaries } from "../functions/_lib/plans";
import {
  explainPromotionBenefits,
  getPromotionConfigForSubscription,
  getPromotionConfigForPlan,
  hasActivePromotionSubscription,
  recordPromotionClick,
  recordPromotionImpression,
} from "../functions/_lib/server-promotions";
import { getServerDiscoveryScore } from "../functions/_lib/server-visibility";
import { publicAdvertisingFromState } from "../functions/_lib/advertising";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import type { Env } from "../functions/_lib/types";

assert.equal(getPromotionConfigForPlan("starter").monthlyCredits, 0);
assert.equal(getPromotionConfigForPlan("pro").monthlyCredits, 2);
assert.equal(getPromotionConfigForPlan("premium").monthlyCredits, 8);
assert.equal(getPromotionConfigForPlan("network").monthlyCredits, 8);
assert.equal(getPromotionConfigForPlan("partner").monthlyCredits, 8);
assert.equal(hasActivePromotionSubscription("active"), true);
assert.equal(hasActivePromotionSubscription("trialing"), true);
for (const inactiveStatus of ["canceled", "cancelled", "past_due", "unpaid", "incomplete", "incomplete_expired", "paused", "expired", null, undefined]) {
  assert.equal(hasActivePromotionSubscription(inactiveStatus), false, `${inactiveStatus} must not unlock paid promotion credits.`);
}
assert.equal(getPromotionConfigForSubscription("pro", "active").monthlyCredits, 2);
assert.equal(getPromotionConfigForSubscription("pro", "trialing").monthlyCredits, 2);
assert.equal(getPromotionConfigForSubscription("premium", "active").monthlyCredits, 8);
assert.equal(getPromotionConfigForSubscription("premium", "trialing").monthlyCredits, 8);
assert.equal(getPromotionConfigForSubscription("network", "active").monthlyCredits, 8);
assert.equal(getPromotionConfigForSubscription("partner", "trialing").monthlyCredits, 8);
assert.equal(getPromotionConfigForSubscription("pro", "canceled").monthlyCredits, 0);
assert.equal(getPromotionConfigForSubscription("premium", "past_due").monthlyCredits, 0);
assert.equal(getPromotionConfigForSubscription("network", "unpaid").monthlyCredits, 0);
assert.equal(getPromotionConfigForSubscription("partner", null).monthlyCredits, 0);

assert.deepEqual(getPromotionConfigForPlan("starter").allowedPromotionTypes, []);
assert.deepEqual(getPromotionConfigForPlan("pro").allowedPromotionTypes, ["directory_bump", "featured_rotation"]);
assert.deepEqual(getPromotionConfigForPlan("premium").allowedPromotionTypes, ["directory_bump", "featured_rotation", "spotlight_boost"]);
assert.equal(getPromotionConfigForPlan("pro").lockedPromotionTypes.some((type) => type.promotionType === "spotlight_boost"), true);
assert.equal(getPromotionConfigForPlan("premium").lockedPromotionTypes.some((type) => type.promotionType === "seasonal_push"), true);
assert.equal(explainPromotionBenefits("starter").some((line) => /upgrade/i.test(line)), true);
assert.equal(explainPromotionBenefits("premium").some((line) => /8 monthly/i.test(line)), true);
assert.equal(explainPromotionBenefits("pro").some((line) => /Premium adds Spotlight boosts/i.test(line)), true);

const baseDiscovery = getServerDiscoveryScore({
  planKey: "pro",
  stats_sync: "Active",
  total_joins: 100,
  unique_players: 30,
});
const bumpedDiscovery = getServerDiscoveryScore({
  planKey: "pro",
  stats_sync: "Active",
  total_joins: 100,
  unique_players: 30,
  activePromotions: [{ promotionType: "directory_bump", status: "active", endsAt: "2099-01-01T00:00:00.000Z" }],
});
const spotlightDiscovery = getServerDiscoveryScore({
  planKey: "premium",
  stats_sync: "Active",
  total_joins: 100,
  unique_players: 30,
  activePromotions: [{ promotionType: "spotlight_boost", status: "active", endsAt: "2099-01-01T00:00:00.000Z" }],
});
assert.equal(bumpedDiscovery > baseDiscovery, true, "Active bump should affect discovery score.");
assert.equal(spotlightDiscovery > bumpedDiscovery, true, "Premium spotlight boost should affect discovery score.");

const sorted = sortPublicServersForDiscovery([
  { id: "rank-one", advertising: publicAdvertisingFromState(null), discoveryScore: 10, visibility_weight: 1, rank: 1, score: 900, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "promoted", advertising: publicAdvertisingFromState(null), discoveryScore: 400, visibility_weight: 2, rank: 30, score: 100, created_at: "2026-01-01T00:00:00.000Z" },
]);
assert.equal(sorted[0].id, "promoted");
assert.equal(sorted.find((server) => server.id === "rank-one")?.rank, 1);
assert.equal(sorted.find((server) => server.id === "rank-one")?.score, 900);

const migration = readFileSync("migrations/0048_promotion_credits.sql", "utf8");
for (const table of ["promotion_credits", "server_promotions", "promotion_audit_log"]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `Migration should create ${table}.`);
}
assert.equal(/DROP TABLE|DELETE FROM|TRUNCATE|player_stats/i.test(migration), false, "Migration must stay additive and avoid forbidden tables.");

const analyticsMigration = readFileSync("migrations/0049_promotion_analytics.sql", "utf8");
for (const table of ["promotion_impressions", "promotion_clicks"]) {
  assert.equal(analyticsMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), true, `Analytics migration should create ${table}.`);
  assert.equal(analyticsMigration.includes(`${table}(server_id, occurred_at)`), true, `${table} should support 7-day server aggregation.`);
  assert.equal(analyticsMigration.includes(`${table}(promotion_id, occurred_at)`), true, `${table} should support promotion-scoped diagnostics.`);
}
assert.equal(/DROP TABLE|DELETE FROM|TRUNCATE|player_stats|player_profiles|kill_events|player_events/i.test(analyticsMigration), false, "Analytics migration must stay additive and avoid protected tracking tables.");

const helper = readFileSync("functions/_lib/server-promotions.ts", "utf8");
for (const snippet of [
  "getPromotionConfigForPlan",
  "getPromotionConfigForSubscription",
  "hasActivePromotionSubscription",
  "getServerPromotionCredits",
  "ensurePromotionCreditsForCurrentPeriod",
  "usePromotionCredit",
  "getActivePromotionsForServer",
  "getPromotionStatus",
  "explainPromotionBenefits",
  "recordPromotionImpression",
  "recordPromotionClick",
  "getPromotionAnalytics",
  "impressionsLast7Days",
  "clicksLast7Days",
  "estimatedVisibilityLift",
  "recentPromotionEvents",
  "SELECT COUNT(*) AS total FROM promotion_impressions",
  "SELECT COUNT(*) AS total FROM promotion_clicks",
  "UNION ALL",
  "ORDER BY occurred_at DESC",
  "PROMOTION_ALREADY_ACTIVE",
  "credits_available > 0",
  "lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')",
]) {
  assert.equal(helper.includes(snippet), true, `Promotion helper should include ${snippet}.`);
}
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events/i.test(helper.replace(/nitrado_service_id/g, "")), false, "Promotion helper must not touch protected tracking or Stripe webhook systems.");
assert.equal(typeof recordPromotionImpression, "function");
assert.equal(typeof recordPromotionClick, "function");

const statusEndpoint = readFileSync("functions/api/servers/[serverId]/promotion-status.ts", "utf8");
const useCreditEndpoint = readFileSync("functions/api/servers/[serverId]/promotions/use-credit.ts", "utf8");
const analyticsEndpoint = readFileSync("functions/api/servers/[serverId]/promotion-analytics.ts", "utf8");
for (const endpoint of [statusEndpoint, useCreditEndpoint, analyticsEndpoint]) {
  assert.equal(endpoint.includes("resolveOwnerVisualLoadoutServer"), true, "Promotion endpoints should reuse owner/admin/support resolver.");
  assert.equal(endpoint.includes("status: access.status"), true, "Promotion endpoints should preserve resolver 401/403 status.");
  assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events/i.test(endpoint.replace(/nitrado_service_id/g, "")), false, "Promotion endpoints must not touch protected tracking or Stripe webhook systems.");
}
assert.equal(statusEndpoint.includes("getPromotionStatus"), true);
assert.equal(useCreditEndpoint.includes("usePromotionCredit"), true);
assert.equal(useCreditEndpoint.includes("readJson"), true);
assert.equal(analyticsEndpoint.includes("getPromotionAnalytics"), true);
assert.equal(analyticsEndpoint.includes("PROMOTION_ANALYTICS_UNAVAILABLE"), true);

const publicTrackEndpoint = readFileSync("functions/api/public/promotions/track.ts", "utf8");
assert.equal(publicTrackEndpoint.includes("recordPromotionImpression"), true, "Public tracking endpoint should record impressions.");
assert.equal(publicTrackEndpoint.includes("recordPromotionClick"), true, "Public tracking endpoint should record clicks.");
assert.equal(publicTrackEndpoint.includes("readJson"), true, "Public tracking endpoint should parse JSON safely.");
assert.equal(/user|discord|session|cookie|ip|player_profiles|kill_events|player_events/i.test(publicTrackEndpoint), false, "Public tracking endpoint must not store personal data or touch protected systems.");

const visibilitySource = readFileSync("functions/_lib/server-visibility.ts", "utf8");
assert.equal(visibilitySource.includes("activePromotions"), true, "Visibility helper should accept active promotions.");
assert.equal(visibilitySource.includes("promotionPoints"), true, "Visibility helper should score promotion freshness.");
assert.equal(visibilitySource.includes("does not change competitive leaderboard rank"), true, "Visibility fairness copy should remain explicit.");

const publicServers = readFileSync("functions/api/public/servers.ts", "utf8");
assert.equal(publicServers.includes("active_promotions_json"), true, "Public server API should read active promotions.");
assert.equal(publicServers.includes("activePromotions"), true, "Public server API should expose active promotions safely.");
assert.equal(publicServers.includes("rankA") && publicServers.includes("scoreDiff"), true, "Discovery sorting should retain competitive rank/score as fallback only.");

const serverSettingsUi = readFileSync("components/onboarding/server-settings-page.tsx", "utf8");
for (const snippet of [
  "Server Promotion Credits",
  "/promotion-status",
  "/promotion-analytics",
  "/promotions/use-credit",
  "creditsAvailable",
  "creditsUsed",
  "Promotion Results",
  "impressionsLast7Days",
  "clicksLast7Days",
  "estimatedVisibilityLift",
  "These are discovery/visibility results, not competitive leaderboard boosts.",
  "activePromotions",
  "availablePromotionTypes",
  "lockedPromotionTypes",
  "Promotions affect discovery and visibility only. They do not change competitive leaderboard rankings.",
  "Use Credit",
  "No Credits",
  "Locked",
  "Spotlight boost",
  "Starter has 0 monthly credits",
  "Pro includes 2 monthly credits",
  "Premium includes 8 monthly credits",
  "premium discovery priority",
]) {
  assert.equal(serverSettingsUi.includes(snippet), true, `Promotion credits UI should include ${snippet}.`);
}
assert.equal(serverSettingsUi.includes("actionState.busy || !promotion.allowed || creditsAvailable <= 0 || active"), true, "Promotion buttons should disable when busy, locked, out of credits, or already active.");
assert.equal(serverSettingsUi.includes("method: \"POST\""), true, "Use credit action should call POST endpoint.");
assert.equal(serverSettingsUi.includes("safeErrorMessage(error, \"Promotion credit could not be used right now.\")"), true, "Use credit action should show API error messages.");
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events/i.test(serverSettingsUi.replace(/nitrado_service_id/g, "")), false, "Promotion UI must not touch protected tracking or Stripe webhook systems.");

const publicNetworkUi = readFileSync("components/network/public-network.tsx", "utf8");
assert.equal(publicNetworkUi.includes("/api/public/promotions/track"), true, "Public discovery cards should send lightweight promotion analytics.");
assert.equal(publicNetworkUi.includes("navigator.sendBeacon"), true, "Promotion tracking should be non-blocking where supported.");
assert.equal(publicNetworkUi.includes("Promotion analytics must never block public browsing."), true, "Public tracking failures should be ignored.");
const trackingHelperSource = publicNetworkUi.slice(publicNetworkUi.indexOf("function trackPromotionEvent"), publicNetworkUi.indexOf("function publicNetworkCacheKey"));
assert.equal(/user|discord|session|cookie|ip|player_profiles|kill_events|player_events/i.test(trackingHelperSource), false, "Public tracking UI must not collect personal data or touch protected systems.");

const publicPlans = getBillingPlanSummaries({} as Env);
assert.deepEqual(publicPlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(publicPlans.some((plan) => /network|partner/i.test(`${plan.plan_key} ${plan.name} ${plan.price_label}`)), false);

console.log("Promotion credits backend tests passed.");
