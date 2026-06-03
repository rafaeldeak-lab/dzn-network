import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  buildAchievementShowcase,
} from "../functions/_lib/reputation";
import {
  getAvailableFrameKeys,
  getAvailableThemeBannerKeys,
  getBadgeVisualConfig,
  getCrownVisual,
  getPlanVisualTreatment,
  getReputationVisual,
  getSeasonalVisual,
  getServerProfileFrame,
  getServerShowcaseBadges,
  getServerThemeBanner,
  getServerVisualShowcase,
} from "../lib/badges/visuals";
import { getBillingPlanSummaries } from "../functions/_lib/plans";
import type { Env } from "../functions/_lib/types";

const barrel = getBadgeVisualConfig("premium_server", "premium");
assert.equal(barrel.rarity, "premium");
assert.equal(barrel.animationType, "premium");
assert.equal(barrel.staticIconUrl?.startsWith("/badges/"), true);

const deathDealer = getBadgeVisualConfig("death_dealer_3", "combat", "Death Dealer 3");
assert.equal(deathDealer.rarity, "rare");
assert.equal(deathDealer.theme, "combat");
assert.equal(deathDealer.glowColour, "#ef4444");

const reputation = getReputationVisual("Diamond");
assert.equal(reputation.tier, "Diamond");
assert.equal(reputation.rarity, "legendary");
assert.equal(reputation.animationType, "legendary");

const crown = getCrownVisual("king_of_pvp");
assert.equal(crown.key, "king_of_pvp");
assert.equal(crown.rarity, "crown");
assert.equal(crown.animationType, "crown");

const seasonal = getSeasonalVisual("summer_champion_2027");
assert.equal(seasonal.key, "summer_champion");
assert.equal(seasonal.rarity, "seasonal");
assert.equal(seasonal.animationType, "seasonal");

assert.equal(getPlanVisualTreatment("network").planKey, "premium");
assert.equal(getPlanVisualTreatment("partner").planKey, "premium");
assert.equal(getPlanVisualTreatment("premium").visibilityWeight, 4);
assert.equal(getPlanVisualTreatment("premium").premiumBadgeEligible, true);
assert.equal(getPlanVisualTreatment("pro").customThemeEligible, true);
assert.equal(getPlanVisualTreatment("starter").animatedFrameEligible, false);

const achievementShowcase = buildAchievementShowcase({
  planKey: "premium",
  createdAt: "2024-01-01T00:00:00.000Z",
  totalKills: 500,
  totalJoins: 1200,
  totalDisconnects: 1000,
  uniquePlayers: 120,
  seasonalParticipationCount: 2,
  rank: 1,
  category: "pvp",
  score: 1200,
  active: true,
});

const badges = getServerShowcaseBadges({
  planKey: "premium",
  reputationTier: "Diamond",
  category: "pvp",
  achievementShowcase,
  maxBadges: 8,
});
assert.equal(badges.some((badge) => badge.code === "king_of_pvp"), true);
assert.equal(badges.some((badge) => badge.code === "premium_server"), true);
assert.equal(badges.some((badge) => badge.category === "reputation" && badge.name.includes("Diamond")), true);
assert.equal(badges.every((badge) => badge.staticIconUrl !== undefined && badge.imageAlt.length > 0), true);

const profileFrame = getServerProfileFrame({ planKey: "premium", reputationTier: "Bronze" });
assert.equal(profileFrame.key, "premium");
assert.equal(profileFrame.isAnimated, true);
const earnedFrame = getServerProfileFrame({ planKey: "starter", reputationTier: "Legendary" });
assert.equal(earnedFrame.key, "legendary");

const themeBanner = getServerThemeBanner({ planKey: "starter", category: "deathmatch", mapName: null });
assert.equal(themeBanner.key, "neon_city");
assert.equal(themeBanner.palette.length >= 3, true);
assert.equal(themeBanner.backgroundUrl?.startsWith("/themes/"), true);

const fullVisuals = getServerVisualShowcase({
  planKey: "premium",
  reputationTier: "Diamond",
  category: "pvp",
  mapName: "Chernarus",
  achievementShowcase,
});
assert.equal(Array.isArray(fullVisuals.badges), true);
assert.equal(fullVisuals.profileFrame.key, "premium");
assert.equal(fullVisuals.themeBanner.key, "space");
assert.equal(fullVisuals.planVisualTreatment.planKey, "premium");

const activePlans = getBillingPlanSummaries({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PREMIUM: "price_premium",
} as Env);
assert.deepEqual(activePlans.map((plan) => plan.plan_key), ["starter", "pro", "premium"]);
assert.equal(JSON.stringify(activePlans).includes("Network"), false);
assert.equal(JSON.stringify(activePlans).includes("Partner"), false);

for (const path of [
  "public/badges/README.md",
  "public/badges/combat/README.md",
  "public/badges/reputation/README.md",
  "public/badges/crowns/README.md",
  "public/badges/seasonal/README.md",
  "public/badges/premium/README.md",
  "public/badges/community/README.md",
  "public/badges/legendary/README.md",
  "public/frames/README.md",
  "public/themes/README.md",
]) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
}

const frames = getAvailableFrameKeys();
for (const key of ["premium", "platinum", "diamond", "emerald", "gold", "silver", "bronze", "legendary", "neon", "toxic", "fire", "ice", "space", "seasonal"]) {
  assert.equal(frames.includes(key), true, `${key} frame should be configured.`);
}
const themes = getAvailableThemeBannerKeys();
for (const key of ["apocalypse", "chernarus", "winter", "desert", "neon_city", "toxic_zone", "island", "space", "military", "night_ops"]) {
  assert.equal(themes.includes(key), true, `${key} theme should be configured.`);
}

const componentSource = readFileSync("components/badges/server-visuals.tsx", "utf8");
for (const componentName of ["BadgeIcon", "AnimatedBadge", "BadgeTooltip", "BadgeGrid", "BadgeShowcase", "ReputationBadge", "CrownBadge", "SeasonalBadge", "PremiumBadge", "ServerProfileFrame", "ServerThemeBanner", "ServerCardBadges"]) {
  assert.equal(componentSource.includes(`function ${componentName}`), true, `${componentName} component should exist.`);
}
assert.equal(componentSource.includes("loading=\"lazy\""), true);
assert.equal(componentSource.includes("alt={badge.imageAlt}"), true);
assert.equal(componentSource.includes("tabIndex={0}"), true);

const css = readFileSync("app/globals.css", "utf8");
for (const animation of ["dznBadgeGlowPulse", "dznBadgeShimmer", "dznBadgeSparks", "dznBadgeElectric", "dznBadgeFireAura", "dznBadgeCrownShine", "dznBadgeSeasonalSparkle", "dznBadgeLegendaryAura", "dznBadgePremiumGlow"]) {
  assert.equal(css.includes(animation), true, `${animation} should be defined.`);
}
assert.equal(css.includes("@media (prefers-reduced-motion: reduce)"), true);

const publicApiSource = readFileSync("functions/api/public/servers.ts", "utf8");
for (const field of ["badges", "profileFrame", "themeBanner", "planVisualTreatment", "getServerVisualShowcase"]) {
  assert.equal(publicApiSource.includes(field), true, `${field} should be present in public server API output.`);
}

const migration = readFileSync("migrations/0044_badge_visual_showcase.sql", "utf8");
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS badge_visual_definitions"), true);
assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS server_visual_preferences"), true);
assert.equal(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+player_profiles|player_stats/i.test(migration), false);

console.log("Badge visual system tests passed.");
