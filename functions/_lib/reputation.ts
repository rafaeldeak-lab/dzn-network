import { getPlanVisibilityWeight, hasPlanFeature, normalizePlanKey } from "./plans";

export type AchievementCategory = "combat" | "community" | "growth" | "activity" | "founder" | "seasonal" | "premium" | "legendary";
export type ReputationTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Legendary";
export type CrownKey = "king_of_pvp" | "king_of_survival" | "king_of_deathmatch" | "king_of_pve" | "king_of_dzn";

export type AchievementDefinition = {
  key: string;
  name: string;
  category: AchievementCategory;
  description: string;
  points: number;
  permanent: boolean;
  limitedAvailability?: boolean;
};

export type ReputationInput = {
  planKey?: unknown;
  createdAt?: string | null;
  totalKills?: number | null;
  totalDeaths?: number | null;
  totalJoins?: number | null;
  totalDisconnects?: number | null;
  uniquePlayers?: number | null;
  activityConsistency?: number | null;
  seasonalParticipationCount?: number | null;
  achievementCount?: number | null;
  championshipWins?: number | null;
  communityGrowth?: number | null;
  score?: number | null;
  rank?: number | null;
  category?: string | null;
  active?: boolean;
};

export type ReputationSummary = {
  tier: ReputationTier;
  score: number;
  nextTier: ReputationTier | null;
  nextTierScore: number | null;
  progressToNextTier: number;
  visibilityWeight: number;
  premiumStatus: "standard" | "premium";
  sources: {
    serverAge: number;
    activityConsistency: number;
    uniquePlayers: number;
    seasonalParticipation: number;
    achievementCount: number;
    championshipWins: number;
    communityGrowth: number;
    premiumMultiplier: number;
  };
};

export type AchievementShowcase = {
  topEarnedBadges: AchievementDefinition[];
  crownBadges: AchievementDefinition[];
  seasonalTrophies: AchievementDefinition[];
  founderBadges: AchievementDefinition[];
  premiumBadges: AchievementDefinition[];
};

export const REPUTATION_LEVELS: Array<{ tier: ReputationTier; minScore: number }> = [
  { tier: "Bronze", minScore: 0 },
  { tier: "Silver", minScore: 150 },
  { tier: "Gold", minScore: 350 },
  { tier: "Platinum", minScore: 650 },
  { tier: "Diamond", minScore: 1000 },
  { tier: "Legendary", minScore: 1450 },
];

export const CROWN_DEFINITIONS: Array<{ key: CrownKey; name: string; category: string; metric: string }> = [
  { key: "king_of_pvp", name: "King of PvP", category: "pvp", metric: "pvp_score" },
  { key: "king_of_survival", name: "King of Survival", category: "survival", metric: "survival_score" },
  { key: "king_of_deathmatch", name: "King of Deathmatch", category: "deathmatch", metric: "deathmatch_score" },
  { key: "king_of_pve", name: "King of PvE", category: "pve", metric: "pve_score" },
  { key: "king_of_dzn", name: "King of DZN", category: "overall", metric: "overall_score" },
];

export const SEASONAL_REWARD_TEMPLATES = ["Spring Champion", "Summer Champion", "Autumn Champion", "Winter Champion"] as const;
export const FOUNDER_REWARD_KEYS = ["founder", "early_adopter", "beta_veteran", "legacy_server"] as const;

const combatAchievements = buildSeries("combat", [
  ["first_blood", "First Blood", "Record the first confirmed PvP kill."],
  ["death_dealer", "Death Dealer", "Build a meaningful combat record."],
  ["marksman", "Marksman", "Land long-range confirmed eliminations."],
  ["headhunter", "Headhunter", "Stack confirmed headshot eliminations."],
  ["rival_slayer", "Rival Slayer", "Defeat repeat rivals across sessions."],
], 5, 14);

const communityAchievements = buildSeries("community", [
  ["welcoming_camp", "Welcoming Camp", "Bring new players into the server."],
  ["full_house", "Full House", "Sustain a healthy active population."],
  ["trusted_node", "Trusted Node", "Keep a reliable public listing online."],
  ["review_magnet", "Review Magnet", "Earn strong community reviews."],
  ["returning_squad", "Returning Squad", "Retain players over repeated sessions."],
], 5, 12);

const growthAchievements = buildSeries("growth", [
  ["rising_signal", "Rising Signal", "Grow steadily across the network."],
  ["population_surge", "Population Surge", "Record major join growth."],
  ["discovery_climb", "Discovery Climb", "Improve discovery visibility."],
  ["rank_climber", "Rank Climber", "Move up public server standings."],
  ["network_presence", "Network Presence", "Build a consistent DZN footprint."],
], 5, 12);

const activityAchievements = buildSeries("activity", [
  ["steady_watch", "Steady Watch", "Maintain consistent ADM-backed activity."],
  ["prime_time", "Prime Time", "Stay active through peak windows."],
  ["daily_signal", "Daily Signal", "Produce regular tracked server activity."],
  ["session_streak", "Session Streak", "Keep players active over time."],
  ["sync_regular", "Sync Regular", "Keep public stats refreshed."],
], 5, 12);

const premiumAchievements = buildSeries("premium", [
  ["premium_server", "Premium Server", "Maintain Premium network membership."],
  ["spotlight_ready", "Spotlight Ready", "Qualify for server spotlight placement."],
  ["priority_signal", "Priority Signal", "Use Premium visibility tools responsibly."],
  ["featured_rotation", "Featured Rotation", "Join Premium featured discovery rotation."],
  ["profile_showcase", "Profile Showcase", "Maintain an enhanced server profile."],
], 4, 12);

const legendaryAchievements = buildSeries("legendary", [
  ["network_legend", "Network Legend", "Reach elite all-network reputation."],
  ["champion_server", "Champion Server", "Win a DZN championship."],
  ["dynasty", "Dynasty", "Hold elite status across multiple seasons."],
  ["crown_challenger", "Crown Challenger", "Compete for a DZN crown."],
  ["universal_contender", "Universal Contender", "Contend across several DZN categories."],
], 4, 18);

const seasonalAchievements: AchievementDefinition[] = [
  ...seasonalSeries(2027),
  ...seasonalSeries(2028),
  ...seasonalSeries(2029),
  ...seasonalSeries(2030),
];

const founderAchievements: AchievementDefinition[] = [
  { key: "founder", name: "Founder", category: "founder", description: "Limited founder-era server reward.", points: 80, permanent: true, limitedAvailability: true },
  { key: "early_adopter", name: "Early Adopter", category: "founder", description: "Joined DZN before the early-adopter window closed.", points: 60, permanent: true, limitedAvailability: true },
  { key: "beta_veteran", name: "Beta Veteran", category: "founder", description: "Participated during beta-era DZN testing.", points: 70, permanent: true, limitedAvailability: true },
  { key: "legacy_server", name: "Legacy Server", category: "founder", description: "Permanent legacy server recognition.", points: 70, permanent: true, limitedAvailability: true },
];

const crownAchievements: AchievementDefinition[] = CROWN_DEFINITIONS.map((crown) => ({
  key: crown.key,
  name: crown.name,
  category: "legendary",
  description: `Current holder of the ${crown.name} crown.`,
  points: 120,
  permanent: false,
}));

export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
  ...combatAchievements,
  ...communityAchievements,
  ...growthAchievements,
  ...activityAchievements,
  ...seasonalAchievements,
  ...founderAchievements,
  ...premiumAchievements,
  ...legendaryAchievements,
  ...crownAchievements,
];

export function calculateReputationScore(input: ReputationInput): ReputationSummary {
  const plan = normalizePlanKey(input.planKey);
  const ageDays = daysSince(input.createdAt);
  const serverAge = Math.min(220, Math.floor(ageDays * 1.6));
  const activityConsistency = Math.min(180, Math.round(numberOrZero(input.activityConsistency) * 180));
  const uniquePlayers = Math.min(220, Math.round(Math.sqrt(numberOrZero(input.uniquePlayers)) * 18));
  const seasonalParticipation = Math.min(160, numberOrZero(input.seasonalParticipationCount) * 35);
  const achievementCount = Math.min(260, numberOrZero(input.achievementCount) * 8);
  const championshipWins = Math.min(320, numberOrZero(input.championshipWins) * 90);
  const communityGrowth = Math.min(180, Math.round(numberOrZero(input.communityGrowth) * 3));
  const rawScore = serverAge + activityConsistency + uniquePlayers + seasonalParticipation + achievementCount + championshipWins + communityGrowth;
  const premiumMultiplier = hasPlanFeature(plan, "premium_reputation_multiplier") ? 1.08 : 1;
  const finalScore = Math.round(rawScore * premiumMultiplier);
  const tier = reputationTierForScore(finalScore);
  const next = nextReputationTier(finalScore);

  return {
    tier,
    score: finalScore,
    nextTier: next?.tier ?? null,
    nextTierScore: next?.minScore ?? null,
    progressToNextTier: next ? Math.min(100, Math.round((finalScore / next.minScore) * 100)) : 100,
    visibilityWeight: getPlanVisibilityWeight(plan),
    premiumStatus: hasPlanFeature(plan, "premium_badge") ? "premium" : "standard",
    sources: {
      serverAge,
      activityConsistency,
      uniquePlayers,
      seasonalParticipation,
      achievementCount,
      championshipWins,
      communityGrowth,
      premiumMultiplier,
    },
  };
}

export function buildServerReputationSummary(input: ReputationInput): ReputationSummary {
  return calculateReputationScore({
    ...input,
    activityConsistency: input.activityConsistency ?? inferActivityConsistency(input),
    achievementCount: input.achievementCount ?? inferAchievementCount(input),
    communityGrowth: input.communityGrowth ?? inferCommunityGrowth(input),
  });
}

export function buildAchievementShowcase(input: ReputationInput): AchievementShowcase {
  const plan = normalizePlanKey(input.planKey);
  const category = String(input.category ?? "").toLowerCase();
  const totalKills = numberOrZero(input.totalKills);
  const uniquePlayers = numberOrZero(input.uniquePlayers);
  const active = input.active !== false;
  const topEarnedBadges = ACHIEVEMENT_CATALOG
    .filter((achievement) => {
      if (achievement.category === "combat") return totalKills >= achievement.points;
      if (achievement.category === "community" || achievement.category === "growth" || achievement.category === "activity") return active && uniquePlayers >= Math.max(5, Math.floor(achievement.points / 2));
      if (achievement.category === "legendary") return numberOrZero(input.score) >= 700 || numberOrZero(input.championshipWins) > 0;
      return false;
    })
    .slice(0, 8);

  return {
    topEarnedBadges,
    crownBadges: crownAchievements.filter((achievement) => crownMatchesCategory(achievement.key as CrownKey, category, input.rank)),
    seasonalTrophies: seasonalAchievements.slice(0, Math.min(4, numberOrZero(input.seasonalParticipationCount))),
    founderBadges: daysSince(input.createdAt) >= 180 ? founderAchievements.slice(0, 1) : [],
    premiumBadges: hasPlanFeature(plan, "premium_badge") ? premiumAchievements.slice(0, 2) : [],
  };
}

export function resolveCrownTransfer(input: {
  crownKey: CrownKey;
  currentHolderServerId: string | null;
  currentScore: number | null;
  candidateServerId: string;
  candidateScore: number;
}) {
  const currentScore = numberOrZero(input.currentScore);
  const shouldTransfer = !input.currentHolderServerId || input.candidateScore > currentScore;
  return {
    crownKey: input.crownKey,
    previousHolderServerId: shouldTransfer ? input.currentHolderServerId : null,
    newHolderServerId: shouldTransfer ? input.candidateServerId : input.currentHolderServerId,
    transferred: shouldTransfer && input.currentHolderServerId !== input.candidateServerId,
  };
}

export function reputationTierForScore(score: number): ReputationTier {
  const matched = [...REPUTATION_LEVELS].reverse().find((level) => score >= level.minScore);
  return matched?.tier ?? "Bronze";
}

function nextReputationTier(score: number) {
  return REPUTATION_LEVELS.find((level) => level.minScore > score) ?? null;
}

function buildSeries(category: AchievementCategory, seeds: Array<[string, string, string]>, levels: number, pointsStep: number): AchievementDefinition[] {
  return seeds.flatMap(([key, name, description]) =>
    Array.from({ length: levels }, (_, index) => ({
      key: `${key}_${index + 1}`,
      name: `${name} ${index + 1}`,
      category,
      description: `${description} Tier ${index + 1}.`,
      points: (index + 1) * pointsStep,
      permanent: true,
    })),
  );
}

function seasonalSeries(year: number): AchievementDefinition[] {
  return SEASONAL_REWARD_TEMPLATES.map((season, index) => ({
    key: `${season.toLowerCase().replace(/\s+/g, "_")}_${year}`,
    name: `${season} ${year}`,
    category: "seasonal" as const,
    description: `Permanent ${season.toLowerCase()} reward for ${year}.`,
    points: 90 + index * 5,
    permanent: true,
  }));
}

function crownMatchesCategory(crownKey: CrownKey, category: string, rank: number | null | undefined) {
  if (numberOrZero(rank) !== 1) return false;
  if (crownKey === "king_of_dzn") return true;
  if (crownKey === "king_of_deathmatch") return category.includes("deathmatch");
  if (crownKey === "king_of_pve") return category === "pve";
  if (crownKey === "king_of_pvp") return category === "pvp" || category === "pvp_pve";
  if (crownKey === "king_of_survival") return category === "pve" || category === "pvp_pve";
  return false;
}

function inferActivityConsistency(input: ReputationInput) {
  const joins = numberOrZero(input.totalJoins);
  const disconnects = numberOrZero(input.totalDisconnects);
  if (joins <= 0) return input.active ? 0.25 : 0;
  return Math.min(1, Math.max(0.1, disconnects / joins));
}

function inferAchievementCount(input: ReputationInput) {
  const kills = numberOrZero(input.totalKills);
  const uniquePlayers = numberOrZero(input.uniquePlayers);
  return Math.min(40, Math.floor(kills / 25) + Math.floor(uniquePlayers / 10));
}

function inferCommunityGrowth(input: ReputationInput) {
  return Math.min(60, numberOrZero(input.uniquePlayers) + Math.floor(numberOrZero(input.totalJoins) / 20));
}

function daysSince(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
