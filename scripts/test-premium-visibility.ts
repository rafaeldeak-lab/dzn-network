import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getBillingPlanSummaries } from "../functions/_lib/plans";
import {
  explainServerVisibility,
  getFeaturedServerCandidates,
  getPlanVisibilityWeight,
  getRecommendedServers,
  getServerDiscoveryScore,
  getServerVisibilityConfig,
  getSpotlightEligibleServers,
} from "../functions/_lib/server-visibility";
import { publicAdvertisingFromState } from "../functions/_lib/advertising";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import type { Env } from "../functions/_lib/types";

assert.equal(getPlanVisibilityWeight("starter"), 1);
assert.equal(getPlanVisibilityWeight("pro"), 2);
assert.equal(getPlanVisibilityWeight("premium"), 4);
assert.equal(getPlanVisibilityWeight("network"), 4);
assert.equal(getPlanVisibilityWeight("partner"), 4);

assert.equal(getServerVisibilityConfig({ planKey: "starter" }).isSpotlightEligible, false);
assert.equal(getServerVisibilityConfig({ planKey: "pro" }).isFeaturedEligible, true);
assert.equal(getServerVisibilityConfig({ planKey: "premium" }).isSpotlightEligible, true);
assert.equal(getServerVisibilityConfig({ planKey: "network" }).visibilityTier, "premium");
assert.equal(getServerVisibilityConfig({ planKey: "partner" }).visibilityTier, "premium");

const starterScore = getServerDiscoveryScore({
  planKey: "starter",
  stats_sync: "Active",
  reputation: { tier: "Bronze", score: 50 },
});
const premiumScore = getServerDiscoveryScore({
  planKey: "premium",
  stats_sync: "Active",
  reputation: { tier: "Diamond", score: 1200 },
  earnedBadges: [{ code: "premium_server" }, { code: "diamond" }],
  public_description: "A complete public profile.",
  tags: ["PvP", "Events"],
  visualLoadout: {
    source: "saved",
    showcaseBadgeCodes: ["premium_server", "diamond"],
    profileFrameKey: "premium",
    themeBannerKey: "chernarus",
    animationEnabled: true,
  },
});
assert.equal(premiumScore > starterScore, true, "Premium discovery should score higher when activity/profile inputs are comparable.");

const activityScore = getServerDiscoveryScore({ planKey: "pro", stats_sync: "Active", total_joins: 500, unique_players: 80 });
const quietScore = getServerDiscoveryScore({ planKey: "pro", stats_sync: "Pending", total_joins: 0, unique_players: 0 });
assert.equal(activityScore > quietScore, true, "Recent activity should improve discovery score.");

const candidates = [
  { id: "starter", planKey: "starter", rank: 1, score: 999, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "pro", planKey: "pro", rank: 2, score: 500, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "premium", planKey: "premium", rank: 99, score: 10, created_at: "2026-01-01T00:00:00.000Z" },
];
assert.deepEqual(getFeaturedServerCandidates({ servers: candidates }).map((server) => server.id), ["premium", "pro"]);
assert.deepEqual(getSpotlightEligibleServers({ servers: candidates }).map((server) => server.id), ["premium"]);
assert.equal(getRecommendedServers({ servers: candidates })[0].id, "premium");

const sorted = sortPublicServersForDiscovery([
  { id: "competitive-rank-one", advertising: publicAdvertisingFromState(null), discoveryScore: 10, visibility_weight: 1, rank: 1, score: 900, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "premium-discovery", advertising: publicAdvertisingFromState(null), discoveryScore: 500, visibility_weight: 4, rank: 40, score: 100, created_at: "2026-01-01T00:00:00.000Z" },
]);
assert.equal(sorted[0].id, "premium-discovery");
assert.equal(sorted.find((server) => server.id === "competitive-rank-one")?.rank, 1);
assert.equal(sorted.find((server) => server.id === "competitive-rank-one")?.score, 900);

const explanation = explainServerVisibility({ planKey: "premium" });
assert.match(explanation.fairness, /does not change competitive leaderboard rank/i);

const publicServers = readFileSync("functions/api/public/servers.ts", "utf8");
const publicNetwork = readFileSync("components/network/public-network.tsx", "utf8");
for (const field of ["visibilityWeight", "discoveryScore", "visibilityTier", "isFeaturedEligible", "isSpotlightEligible", "visibilityExplanation"]) {
  assert.equal(publicServers.includes(field), true, `/api/public/servers should expose ${field}.`);
}
for (const group of ["featuredServers", "spotlightServers", "recommendedServers", "standardServers"]) {
  assert.equal(publicServers.includes(group), true, `/api/public/servers should prepare ${group}.`);
  assert.equal(publicNetwork.includes(group), true, `Public network UI should consume ${group}.`);
}
assert.equal(publicServers.includes("rankA") && publicServers.includes("scoreDiff"), true, "Discovery sorting should retain competitive rank/score as fallback only.");
assert.equal(publicNetwork.includes("Premium Spotlight Servers"), true, "Spotlight section should render when spotlightServers exist.");
assert.equal(publicNetwork.includes("!spotlightServers.length") && publicNetwork.includes("return null"), true, "Spotlight/recommendation sections should hide safely when empty.");
assert.equal(publicNetwork.includes("Featured Servers"), true, "Featured section should render featuredServers.");
assert.equal(publicNetwork.includes("Recommended Servers"), true, "Recommended section should render recommendedServers.");
assert.equal(publicNetwork.includes("Recommended by activity, reputation, profile quality and visibility settings."), true, "Recommended copy should explain discovery placement.");
assert.equal(publicNetwork.includes("All Public Servers"), true, "Standard server directory should still render.");
assert.equal(publicNetwork.includes('tier === "premium" ? "Premium"'), true, "Premium label should only be used for premium visibility tier.");
assert.equal(publicNetwork.includes("Spotlight Eligible"), true, "Spotlight eligible label should be available for eligible servers.");
assert.equal(publicNetwork.includes("do not change competitive rank"), true, "Public UI copy should preserve competitive ranking fairness.");

const docs = readFileSync("docs/PREMIUM_VISIBILITY_SYSTEM.md", "utf8");
for (const text of ["What It Affects", "What It Does Not Affect", "Spotlight Eligibility", "competitive leaderboards remain fair"]) {
  assert.equal(docs.toLowerCase().includes(text.toLowerCase()), true, `Premium visibility docs should include ${text}.`);
}

const publicPlans = getBillingPlanSummaries({} as Env);
assert.deepEqual(publicPlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(publicPlans.some((plan) => /network|partner/i.test(`${plan.plan_key} ${plan.name} ${plan.price_label}`)), false);

const visibilitySource = readFileSync("functions/_lib/server-visibility.ts", "utf8");
assert.equal(/from\s+["'][^"']*(adm|nitrado|stripe)[^"']*["']|player_profiles|kill_events|player_events|stripe\/webhook/i.test(visibilitySource), false, "Visibility helper must not touch protected tracking or Stripe webhook systems.");

console.log("Premium visibility foundation tests passed.");
