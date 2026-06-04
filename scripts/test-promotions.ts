import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getBillingPlanSummaries } from "../functions/_lib/plans";
import {
  explainPromotionBenefits,
  getPromotionConfigForPlan,
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

assert.deepEqual(getPromotionConfigForPlan("starter").allowedPromotionTypes, []);
assert.deepEqual(getPromotionConfigForPlan("pro").allowedPromotionTypes, ["directory_bump", "featured_rotation"]);
assert.deepEqual(getPromotionConfigForPlan("premium").allowedPromotionTypes, ["directory_bump", "featured_rotation", "spotlight_boost"]);
assert.equal(getPromotionConfigForPlan("pro").lockedPromotionTypes.some((type) => type.promotionType === "spotlight_boost"), true);
assert.equal(getPromotionConfigForPlan("premium").lockedPromotionTypes.some((type) => type.promotionType === "seasonal_push"), true);
assert.equal(explainPromotionBenefits("starter").some((line) => /upgrade/i.test(line)), true);
assert.equal(explainPromotionBenefits("premium").some((line) => /8 monthly/i.test(line)), true);

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

const helper = readFileSync("functions/_lib/server-promotions.ts", "utf8");
for (const snippet of [
  "getPromotionConfigForPlan",
  "getServerPromotionCredits",
  "ensurePromotionCreditsForCurrentPeriod",
  "usePromotionCredit",
  "getActivePromotionsForServer",
  "getPromotionStatus",
  "explainPromotionBenefits",
  "PROMOTION_ALREADY_ACTIVE",
  "credits_available > 0",
]) {
  assert.equal(helper.includes(snippet), true, `Promotion helper should include ${snippet}.`);
}
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events/i.test(helper.replace(/nitrado_service_id/g, "")), false, "Promotion helper must not touch protected tracking or Stripe webhook systems.");

const statusEndpoint = readFileSync("functions/api/servers/[serverId]/promotion-status.ts", "utf8");
const useCreditEndpoint = readFileSync("functions/api/servers/[serverId]/promotions/use-credit.ts", "utf8");
for (const endpoint of [statusEndpoint, useCreditEndpoint]) {
  assert.equal(endpoint.includes("resolveOwnerVisualLoadoutServer"), true, "Promotion endpoints should reuse owner/admin/support resolver.");
  assert.equal(endpoint.includes("status: access.status"), true, "Promotion endpoints should preserve resolver 401/403 status.");
  assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events/i.test(endpoint.replace(/nitrado_service_id/g, "")), false, "Promotion endpoints must not touch protected tracking or Stripe webhook systems.");
}
assert.equal(statusEndpoint.includes("getPromotionStatus"), true);
assert.equal(useCreditEndpoint.includes("usePromotionCredit"), true);
assert.equal(useCreditEndpoint.includes("readJson"), true);

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
  "/promotions/use-credit",
  "creditsAvailable",
  "creditsUsed",
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
]) {
  assert.equal(serverSettingsUi.includes(snippet), true, `Promotion credits UI should include ${snippet}.`);
}
assert.equal(serverSettingsUi.includes("actionState.busy || !promotion.allowed || creditsAvailable <= 0 || active"), true, "Promotion buttons should disable when busy, locked, out of credits, or already active.");
assert.equal(serverSettingsUi.includes("method: \"POST\""), true, "Use credit action should call POST endpoint.");
assert.equal(serverSettingsUi.includes("safeErrorMessage(error, \"Promotion credit could not be used right now.\")"), true, "Use credit action should show API error messages.");
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe\/webhook)[^"']*["']|player_profiles|kill_events|player_events/i.test(serverSettingsUi.replace(/nitrado_service_id/g, "")), false, "Promotion UI must not touch protected tracking or Stripe webhook systems.");

const publicPlans = getBillingPlanSummaries({} as Env);
assert.deepEqual(publicPlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(publicPlans.some((plan) => /network|partner/i.test(`${plan.plan_key} ${plan.name} ${plan.price_label}`)), false);

console.log("Promotion credits backend tests passed.");
