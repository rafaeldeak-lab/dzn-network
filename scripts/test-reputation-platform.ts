import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getBillingPlanSummaries, getCheckoutConfigured, getPlanFromStripePriceId } from "../functions/_lib/plans";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import { publicAdvertisingFromState } from "../functions/_lib/advertising";
import {
  ACHIEVEMENT_CATALOG,
  CROWN_DEFINITIONS,
  FOUNDER_REWARD_KEYS,
  REPUTATION_LEVELS,
  SEASONAL_REWARD_TEMPLATES,
  buildAchievementShowcase,
  buildServerReputationSummary,
  resolveCrownTransfer,
} from "../functions/_lib/reputation";
import type { Env } from "../functions/_lib/types";

assert.deepEqual(getCheckoutConfigured({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PREMIUM: "price_premium",
} as Env), { starter: true, pro: true, premium: true });

assert.equal(getPlanFromStripePriceId({
  STRIPE_PRICE_NETWORK: "price_network_legacy",
  STRIPE_PRICE_PARTNER: "price_partner_legacy",
} as Env, "price_network_legacy"), "premium");
assert.equal(getPlanFromStripePriceId({
  STRIPE_PRICE_NETWORK: "price_network_legacy",
  STRIPE_PRICE_PARTNER: "price_partner_legacy",
} as Env, "price_partner_legacy"), "premium");

const summaries = getBillingPlanSummaries({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PREMIUM: "price_premium",
} as Env);
assert.deepEqual(summaries.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(summaries.find((plan) => plan.plan_key === "starter")?.visibility_weight, 1);
assert.equal(summaries.find((plan) => plan.plan_key === "pro")?.visibility_weight, 2);
assert.equal(summaries.find((plan) => plan.plan_key === "premium")?.visibility_weight, 4);
assert.equal(summaries.find((plan) => plan.plan_key === "starter")?.public_publish_interval_minutes, 1440);
assert.equal(summaries.find((plan) => plan.plan_key === "pro")?.public_publish_interval_minutes, 240);
assert.equal(summaries.find((plan) => plan.plan_key === "premium")?.public_publish_interval_minutes, 0);
const planSummaryKeys = summaries.map((plan) => String(plan.plan_key));
assert.equal(planSummaryKeys.includes("network"), false);
assert.equal(planSummaryKeys.includes("partner"), false);

const sorted = sortPublicServersForDiscovery([
  { id: "rank-one", advertising: publicAdvertisingFromState(null), visibility_weight: 1, rank: 1, score: 900, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "premium-low-rank", advertising: publicAdvertisingFromState(null), visibility_weight: 4, rank: 40, score: 100, created_at: "2026-01-01T00:00:00.000Z" },
]);
assert.equal(sorted[0].id, "premium-low-rank", "Visibility weight should affect discovery ordering.");
assert.equal(sorted.find((server) => server.id === "rank-one")?.rank, 1, "Visibility must not mutate competitive rank.");
assert.equal(sorted.find((server) => server.id === "rank-one")?.score, 900, "Visibility must not mutate competitive score.");

assert.equal(ACHIEVEMENT_CATALOG.length >= 100, true, "Launch catalog should contain at least 100 achievement definitions.");
for (const category of ["combat", "community", "growth", "activity", "founder", "seasonal", "premium", "legendary"]) {
  assert.equal(ACHIEVEMENT_CATALOG.some((achievement) => achievement.category === category), true, `${category} achievements should exist.`);
}
assert.equal(CROWN_DEFINITIONS.length, 5);
assert.deepEqual(CROWN_DEFINITIONS.map((crown) => crown.name), ["King of PvP", "King of Survival", "King of Deathmatch", "King of PvE", "King of DZN"]);
assert.deepEqual(SEASONAL_REWARD_TEMPLATES, ["Spring Champion", "Summer Champion", "Autumn Champion", "Winter Champion"]);
assert.deepEqual(FOUNDER_REWARD_KEYS, ["founder", "early_adopter", "beta_veteran", "legacy_server"]);

const bronze = buildServerReputationSummary({ planKey: "starter", createdAt: "2026-05-01T00:00:00.000Z" });
const diamond = buildServerReputationSummary({
  planKey: "premium",
  createdAt: "2024-01-01T00:00:00.000Z",
  totalKills: 1000,
  totalJoins: 2500,
  totalDisconnects: 1800,
  uniquePlayers: 500,
  championshipWins: 6,
  seasonalParticipationCount: 8,
  achievementCount: 80,
  communityGrowth: 100,
});
assert.equal(REPUTATION_LEVELS[0].tier, "Bronze");
assert.equal(bronze.tier, "Bronze");
assert.equal(["Diamond", "Legendary"].includes(diamond.tier), true);
assert.equal(diamond.premiumStatus, "premium");
assert.equal(diamond.visibilityWeight, 4);

const showcase = buildAchievementShowcase({
  planKey: "premium",
  createdAt: "2024-01-01T00:00:00.000Z",
  totalKills: 500,
  uniquePlayers: 100,
  seasonalParticipationCount: 2,
  rank: 1,
  category: "pvp",
  score: 1200,
  active: true,
});
assert.equal(showcase.topEarnedBadges.length > 0, true);
assert.equal(showcase.crownBadges.some((badge) => badge.name === "King of PvP"), true);
assert.equal(showcase.seasonalTrophies.length, 2);
assert.equal(showcase.founderBadges.some((badge) => badge.key === "founder"), true);
assert.equal(showcase.premiumBadges.some((badge) => badge.name === "Premium Server 1"), true);

assert.deepEqual(resolveCrownTransfer({
  crownKey: "king_of_dzn",
  currentHolderServerId: "old-server",
  currentScore: 1200,
  candidateServerId: "new-server",
  candidateScore: 1300,
}), {
  crownKey: "king_of_dzn",
  previousHolderServerId: "old-server",
  newHolderServerId: "new-server",
  transferred: true,
});

const migration = readFileSync("migrations/0043_reputation_achievements.sql", "utf8");
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS server_achievement_awards"), true);
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS server_crown_holders"), true);
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS server_seasonal_rewards"), true);
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS server_reputation_snapshots"), true);
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|player_stats|DROP\s+COLUMN|ALTER\s+TABLE\s+player_profiles/i.test(migration), false);

const publicServersSource = readFileSync("functions/api/public/servers.ts", "utf8");
assert.equal(publicServersSource.includes("visibility_weight"), true);
assert.equal(publicServersSource.includes("buildServerReputationSummary"), true);
assert.equal(publicServersSource.includes("buildAchievementShowcase"), true);

console.log("Reputation platform tests passed.");
