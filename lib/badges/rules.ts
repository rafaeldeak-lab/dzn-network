import { normalizePlanKey } from "../billing/plans";
import {
  getBadgeVisualConfig,
  toVisualBadge,
  type BadgeRarity,
  type VisualBadge,
} from "./visuals";

export type BadgeRuleCategory =
  | "reputation"
  | "premium"
  | "combat"
  | "community"
  | "founder"
  | "crown"
  | "seasonal";

export type BadgeRuleUnlockType =
  | "default"
  | "stat_threshold"
  | "plan"
  | "activity"
  | "age_days"
  | "flag"
  | "admin"
  | "future"
  | "crown"
  | "seasonal";

export type BadgeStatKey =
  | "isActiveListing"
  | "uniquePlayers"
  | "activityConsistency"
  | "achievementCount"
  | "totalKills"
  | "longestKill"
  | "headshots"
  | "highestKillstreak"
  | "serverAgeDays"
  | "recentActivityGrowth"
  | "featured"
  | "verified"
  | "active"
  | "categoryHardcore";

export type BadgeRule = {
  badgeCode: string;
  name: string;
  category: BadgeRuleCategory;
  unlockType: BadgeRuleUnlockType;
  requirementLabel: string;
  requirementDescription: string;
  isPermanent: boolean;
  isLimited: boolean;
  isSeasonal: boolean;
  isCrown: boolean;
  statKey?: BadgeStatKey;
  threshold?: number;
  alternativeStatKey?: BadgeStatKey;
  alternativeThreshold?: number;
  planKey?: "premium" | "pro" | "starter";
  manualOnly?: boolean;
  futureSupported?: boolean;
  protectedAward?: boolean;
};

export type ServerBadgeStatsInput = {
  serverId?: string | null;
  planKey?: unknown;
  createdAt?: string | null;
  totalKills?: number | null;
  totalDeaths?: number | null;
  totalJoins?: number | null;
  totalDisconnects?: number | null;
  uniquePlayers?: number | null;
  longestKill?: number | null;
  headshots?: number | null;
  highestKillstreak?: number | null;
  rank?: number | null;
  score?: number | null;
  category?: string | null;
  active?: boolean | null;
  verified?: boolean | null;
  featured?: boolean | null;
  recentActivityGrowth?: number | null;
  achievementCount?: number | null;
  championshipWins?: number | null;
  communityGrowth?: number | null;
  now?: string | Date | null;
  awardedBadgeCodes?: string[];
  activeCrownCodes?: string[];
  seasonalBadgeCodes?: string[];
  manualBadgeCodes?: string[];
  earnedAtByCode?: Record<string, string | null | undefined>;
};

export type BadgeEvaluation = {
  rule: BadgeRule;
  unlocked: boolean;
  currentValue: number;
  targetValue: number;
  progressPercent: number;
  source: "auto" | "stored" | "manual" | "crown" | "seasonal" | "locked";
  lockedReason: string | null;
};

export type PublicLockedBadge = VisualBadge & {
  requirementLabel: string;
  requirementDescription: string;
  currentValue: number;
  targetValue: number;
  progressPercent: number;
};

export type ServerBadgeCollection = {
  earnedBadges: VisualBadge[];
  lockedBadges: PublicLockedBadge[];
  showcaseBadges: VisualBadge[];
  crowns: VisualBadge[];
  reputationBadge: VisualBadge;
};

const SEASONAL_CODES = ["spring_champion", "summer_champion", "autumn_champion", "winter_champion", "halloween_champion", "christmas_champion", "easter_champion", "new_year_champion"];
const CROWN_CODES = ["king_of_pvp", "king_of_survival", "king_of_deathmatch", "king_of_pve", "king_of_dzn"];

export const BADGE_UNLOCK_RULES: BadgeRule[] = [
  rule("bronze", "Bronze Reputation", "reputation", "default", "Active server listing", "Awarded when a server has an active DZN listing.", true, { statKey: "isActiveListing", threshold: 1 }),
  rule("silver", "Silver Reputation", "reputation", "stat_threshold", "100 unique players", "Awarded at 100 unique players or stable activity.", true, { statKey: "uniquePlayers", threshold: 100, alternativeStatKey: "activityConsistency", alternativeThreshold: 55 }),
  rule("gold", "Gold Reputation", "reputation", "stat_threshold", "500 unique players", "Awarded at 500 unique players or strong activity.", true, { statKey: "uniquePlayers", threshold: 500, alternativeStatKey: "activityConsistency", alternativeThreshold: 70 }),
  rule("platinum", "Platinum Reputation", "reputation", "stat_threshold", "1,000 unique players", "Awarded at 1,000 unique players or high activity.", true, { statKey: "uniquePlayers", threshold: 1000, alternativeStatKey: "activityConsistency", alternativeThreshold: 82 }),
  rule("diamond", "Diamond Reputation", "reputation", "stat_threshold", "2,500 unique players", "Awarded at 2,500 unique players or top-tier activity.", true, { statKey: "uniquePlayers", threshold: 2500, alternativeStatKey: "activityConsistency", alternativeThreshold: 90 }),
  rule("legendary", "Legendary Reputation", "reputation", "stat_threshold", "5,000 unique players", "Awarded at 5,000 unique players or a major achievement count.", true, { statKey: "uniquePlayers", threshold: 5000, alternativeStatKey: "achievementCount", alternativeThreshold: 25 }),
  protectedRule("dzn_legend", "DZN Legend", "reputation", "admin", "Hall of Fame award", "Reserved for future Hall of Fame or admin-awarded legacy recognition."),

  rule("premium_server", "Premium Server", "premium", "plan", "Premium plan active", "Awarded while the server has an active Premium plan.", false, { planKey: "premium" }),
  rule("verified_server", "Verified Server", "premium", "activity", "Connected and verified", "Awarded when a server is connected, verified, or has active sync evidence.", true, { statKey: "verified", threshold: 1, alternativeStatKey: "active", alternativeThreshold: 1 }),
  rule("featured_server", "Featured Server", "premium", "flag", "Featured placement active", "Awarded while DZN featured placement is active.", false, { statKey: "featured", threshold: 1 }),
  rule("trending_server", "Trending Server", "premium", "stat_threshold", "Strong recent activity growth", "Awarded for strong recent activity growth.", false, { statKey: "recentActivityGrowth", threshold: 75 }),
  protectedRule("top_pick", "Top Pick", "premium", "admin", "DZN editorial selection", "Reserved for admin/editorial DZN selections."),
  rule("rising_server", "Rising Server", "premium", "stat_threshold", "New server growth", "Awarded to newer servers with strong recent growth.", false, { statKey: "recentActivityGrowth", threshold: 45 }),
  futureRule("community_favourite", "Community Favourite", "premium", "Community favourite rating", "Reserved for future community vote or rating systems."),
  rule("active_server", "Active Server", "premium", "activity", "Recent ADM activity", "Awarded when recent or all-time ADM activity exists.", false, { statKey: "active", threshold: 1 }),
  protectedRule("exclusive", "Exclusive", "premium", "admin", "Exclusive DZN recognition", "Reserved for admin-awarded special recognition."),
  futureRule("hardcore_mode", "Hardcore Mode", "premium", "Hardcore mode signal", "Reserved until a safe hardcore-mode source is available.", { statKey: "categoryHardcore", threshold: 1 }),

  rule("death_dealer", "Death Dealer", "combat", "stat_threshold", "5,000 confirmed kills", "Awarded when a server reaches 5,000 confirmed PvP kills.", true, { statKey: "totalKills", threshold: 5000 }),
  futureRule("headhunter", "Headhunter", "combat", "1,000 headshots", "Awarded at 1,000 headshots when headshot stats are available.", { statKey: "headshots", threshold: 1000 }),
  rule("long_shot_legend", "Long Shot Legend", "combat", "stat_threshold", "1,000m longest kill", "Awarded when the server records a longest kill of at least 1,000m.", true, { statKey: "longestKill", threshold: 1000 }),
  rule("warlord", "Warlord", "combat", "stat_threshold", "25,000 confirmed kills", "Awarded when a server reaches 25,000 confirmed PvP kills.", true, { statKey: "totalKills", threshold: 25000 }),
  futureRule("hot_streak", "Hot Streak", "combat", "10 killstreak", "Awarded at a 10 killstreak when server-level killstreak stats are available.", { statKey: "highestKillstreak", threshold: 10 }),

  rule("trusted_server", "Trusted Server", "community", "age_days", "30 days active or verified", "Awarded after 30 days active on DZN or verified setup.", true, { statKey: "serverAgeDays", threshold: 30, alternativeStatKey: "verified", alternativeThreshold: 1 }),
  futureRule("team_player", "Team Player", "community", "Team systems used", "Reserved until faction/team feature usage is available."),
  protectedRule("helping_hand", "Helping Hand", "community", "admin", "Community support award", "Reserved for admin-awarded community support recognition."),
  futureRule("loot_master", "Loot Master", "community", "Loot challenge award", "Reserved for future event or challenge scoring."),
  futureRule("event_champion", "Event Champion", "community", "Event winner award", "Reserved for event winner badge assignment."),

  protectedRule("founder", "Founder", "founder", "admin", "Limited founder period", "Limited founder reward. It must be awarded by admin/support tooling."),
  protectedRule("early_adopter", "Early Adopter", "founder", "admin", "Limited early adopter period", "Limited early adopter reward. It must be awarded by admin/support tooling."),
  protectedRule("beta_veteran", "Beta Veteran", "founder", "admin", "Limited beta period", "Limited beta reward. It must be awarded by admin/support tooling."),
  rule("legacy_server", "Legacy Server", "founder", "age_days", "365 days on DZN", "Awarded when a server has been active on DZN for at least 365 days.", true, { statKey: "serverAgeDays", threshold: 365, isLimited: true }),
  protectedRule("pioneer", "Pioneer", "founder", "admin", "Early network participation", "Reserved for early DZN network participation awards."),
  rule("veteran", "Veteran", "founder", "age_days", "180 days on DZN", "Awarded when a server has been active on DZN for at least 180 days.", true, { statKey: "serverAgeDays", threshold: 180, isLimited: true }),

  ...CROWN_CODES.map((code) => rule(code, humanizeBadgeName(code), "crown", "crown", "Current crown holder", "Live crown awarded to the current top server for this crown.", false, { isCrown: true, protectedAward: true })),
  ...SEASONAL_CODES.map((code) => rule(code, humanizeBadgeName(code), "seasonal", "seasonal", "Season champion award", "Permanent seasonal champion reward assigned by event or season results.", true, { isSeasonal: true, protectedAward: true })),
];

export const BADGE_RULE_BY_CODE = Object.fromEntries(BADGE_UNLOCK_RULES.map((badgeRule) => [badgeRule.badgeCode, badgeRule])) as Record<string, BadgeRule>;

export function getBadgeRule(code: string) {
  return BADGE_RULE_BY_CODE[normalizeBadgeCode(code)] ?? null;
}

export function evaluateBadgeRules(input: ServerBadgeStatsInput): BadgeEvaluation[] {
  const normalizedInput = normalizeInput(input);
  const stored = new Set((input.awardedBadgeCodes ?? []).map(normalizeBadgeCode));
  const crowns = new Set((input.activeCrownCodes ?? []).map(normalizeBadgeCode));
  const seasonal = new Set((input.seasonalBadgeCodes ?? []).map(normalizeBadgeCode));
  const manual = new Set((input.manualBadgeCodes ?? []).map(normalizeBadgeCode));

  return BADGE_UNLOCK_RULES.map((badgeRule) => {
    const explicitStored = stored.has(badgeRule.badgeCode) || manual.has(badgeRule.badgeCode);
    const explicitCrown = crowns.has(badgeRule.badgeCode);
    const explicitSeasonal = seasonal.has(badgeRule.badgeCode);
    const targetValue = ruleTargetValue(badgeRule);
    const currentValue = ruleCurrentValue(badgeRule, normalizedInput);
    const statUnlocked = ruleUnlocks(badgeRule, normalizedInput);
    const unlocked = explicitStored || explicitCrown || explicitSeasonal || statUnlocked;
    const source =
      explicitCrown ? "crown" :
      explicitSeasonal ? "seasonal" :
      explicitStored ? "stored" :
      statUnlocked ? "auto" :
      "locked";

    return {
      rule: badgeRule,
      unlocked,
      currentValue,
      targetValue,
      progressPercent: progressPercent(currentValue, targetValue, unlocked),
      source,
      lockedReason: unlocked ? null : lockedReason(badgeRule),
    };
  });
}

export function buildServerBadgeCollection(input: ServerBadgeStatsInput): ServerBadgeCollection {
  const evaluations = evaluateBadgeRules(input);
  const earnedBadges = evaluations
    .filter((evaluation) => evaluation.unlocked)
    .map((evaluation) => toEvaluationVisualBadge(evaluation, input, false))
    .filter((badge) => badge.isPublic);
  const lockedBadges = evaluations
    .filter((evaluation) => !evaluation.unlocked)
    .map((evaluation) => toLockedBadge(evaluation))
    .filter((badge) => badge.isPublic);
  const reputationBadge = selectHighestBadge(earnedBadges.filter((badge) => badge.category === "reputation")) ?? toEvaluationVisualBadge(
    evaluations.find((evaluation) => evaluation.rule.badgeCode === "bronze") ?? evaluateBadgeRules({ ...input, active: true })[0],
    input,
    false,
  );
  const crowns = earnedBadges.filter((badge) => badge.category === "crown" && badge.locked === false);

  return {
    earnedBadges: sortBadges(earnedBadges),
    lockedBadges: sortLockedBadges(lockedBadges),
    showcaseBadges: selectShowcaseBadges(earnedBadges, 6),
    crowns,
    reputationBadge,
  };
}

export function selectShowcaseBadges(earnedBadges: VisualBadge[], maxBadges = 6): VisualBadge[] {
  const selected: VisualBadge[] = [];
  const add = (badge: VisualBadge | null | undefined) => {
    if (!badge || selected.some((item) => item.code === badge.code)) return;
    if (!badge.isPublic || !badge.isShowcaseBadge) return;
    selected.push(badge);
  };

  for (const badge of sortBadges(earnedBadges.filter((item) => item.category === "crown"))) add(badge);
  add(selectHighestBadge(earnedBadges.filter((item) => item.category === "premium")));
  add(selectHighestBadge(earnedBadges.filter((item) => item.category === "reputation")));
  add(sortBadges(earnedBadges.filter((item) => item.category === "seasonal"))[0]);
  add(selectHighestBadge(earnedBadges.filter((item) => !["crown", "premium", "reputation", "seasonal"].includes(item.category))));
  add(sortBadges([...earnedBadges].sort((a, b) => dateValue(b.earnedAt) - dateValue(a.earnedAt)))[0]);

  for (const badge of sortBadges(earnedBadges)) add(badge);
  return selected.slice(0, Math.max(1, maxBadges));
}

export function automaticAwardableEvaluations(input: ServerBadgeStatsInput) {
  return evaluateBadgeRules(input).filter((evaluation) => {
    const rule = evaluation.rule;
    return evaluation.unlocked &&
      evaluation.source === "auto" &&
      !rule.manualOnly &&
      !rule.protectedAward &&
      !rule.isCrown &&
      !rule.isSeasonal &&
      !rule.futureSupported;
  });
}

export function normalizeBadgeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toEvaluationVisualBadge(evaluation: BadgeEvaluation, input: ServerBadgeStatsInput, locked: boolean): VisualBadge {
  const rule = evaluation.rule;
  return toVisualBadge({
    key: rule.badgeCode,
    name: rule.name,
    category: rule.category,
    description: rule.requirementDescription,
    permanent: rule.isPermanent,
  }, {
    earnedAt: locked ? null : input.earnedAtByCode?.[rule.badgeCode] ?? null,
    locked,
  });
}

function toLockedBadge(evaluation: BadgeEvaluation): PublicLockedBadge {
  const badge = toEvaluationVisualBadge(evaluation, {}, true);
  return {
    ...badge,
    requirementLabel: evaluation.rule.requirementLabel,
    requirementDescription: evaluation.rule.requirementDescription,
    currentValue: evaluation.currentValue,
    targetValue: evaluation.targetValue,
    progressPercent: evaluation.progressPercent,
  };
}

function rule(
  badgeCode: string,
  name: string,
  category: BadgeRuleCategory,
  unlockType: BadgeRuleUnlockType,
  requirementLabel: string,
  requirementDescription: string,
  isPermanent: boolean,
  options: Partial<BadgeRule> = {},
): BadgeRule {
  return {
    badgeCode,
    name,
    category,
    unlockType,
    requirementLabel,
    requirementDescription,
    isPermanent,
    isLimited: Boolean(options.isLimited),
    isSeasonal: Boolean(options.isSeasonal),
    isCrown: Boolean(options.isCrown),
    ...options,
  };
}

function protectedRule(
  badgeCode: string,
  name: string,
  category: BadgeRuleCategory,
  unlockType: BadgeRuleUnlockType,
  requirementLabel: string,
  requirementDescription: string,
): BadgeRule {
  return rule(badgeCode, name, category, unlockType, requirementLabel, requirementDescription, true, {
    manualOnly: true,
    protectedAward: true,
    isLimited: category === "founder" || category === "reputation",
  });
}

function futureRule(
  badgeCode: string,
  name: string,
  category: BadgeRuleCategory,
  requirementLabel: string,
  requirementDescription: string,
  options: Partial<BadgeRule> = {},
): BadgeRule {
  return rule(badgeCode, name, category, "future", requirementLabel, requirementDescription, true, {
    futureSupported: true,
    ...options,
  });
}

function normalizeInput(input: ServerBadgeStatsInput) {
  const createdAt = input.createdAt ? new Date(input.createdAt) : null;
  const now = input.now ? new Date(input.now) : new Date();
  const ageMs = createdAt && !Number.isNaN(createdAt.getTime()) ? now.getTime() - createdAt.getTime() : 0;
  const totalKills = numberOrZero(input.totalKills);
  const totalJoins = numberOrZero(input.totalJoins);
  const totalDisconnects = numberOrZero(input.totalDisconnects);
  const uniquePlayers = numberOrZero(input.uniquePlayers);
  const totalEvents = totalKills + numberOrZero(input.totalDeaths) + totalJoins + totalDisconnects;
  const activityConsistency = Math.min(100, Math.round((Math.min(totalJoins, totalDisconnects) / Math.max(1, Math.max(totalJoins, totalDisconnects))) * 60 + Math.min(40, uniquePlayers / 10)));
  const category = String(input.category ?? "").toLowerCase();

  return {
    planKey: normalizePlanKey(input.planKey),
    isActiveListing: input.active === false ? 0 : 1,
    uniquePlayers,
    activityConsistency,
    achievementCount: numberOrZero(input.achievementCount),
    totalKills,
    longestKill: numberOrZero(input.longestKill),
    headshots: input.headshots === null || input.headshots === undefined ? null : numberOrZero(input.headshots),
    highestKillstreak: input.highestKillstreak === null || input.highestKillstreak === undefined ? null : numberOrZero(input.highestKillstreak),
    serverAgeDays: Math.max(0, Math.floor(ageMs / 86400000)),
    recentActivityGrowth: input.recentActivityGrowth === null || input.recentActivityGrowth === undefined ? null : numberOrZero(input.recentActivityGrowth),
    featured: input.featured ? 1 : 0,
    verified: input.verified ? 1 : 0,
    active: input.active || totalEvents > 0 ? 1 : 0,
    categoryHardcore: category.includes("hardcore") ? 1 : 0,
  };
}

function ruleUnlocks(rule: BadgeRule, input: ReturnType<typeof normalizeInput>) {
  if (rule.manualOnly || rule.protectedAward || rule.isCrown || rule.isSeasonal) return false;
  if (rule.unlockType === "future" && rule.futureSupported) {
    if (!rule.statKey || input[rule.statKey] === null) return false;
  }
  if (rule.planKey) return input.planKey === rule.planKey;
  const current = rule.statKey ? input[rule.statKey] : 0;
  const target = rule.threshold ?? 1;
  const primary = typeof current === "number" && current >= target;
  if (primary) return true;
  if (rule.alternativeStatKey) {
    const altCurrent = input[rule.alternativeStatKey];
    const altTarget = rule.alternativeThreshold ?? 1;
    return typeof altCurrent === "number" && altCurrent >= altTarget;
  }
  return false;
}

function ruleCurrentValue(rule: BadgeRule, input: ReturnType<typeof normalizeInput>) {
  if (rule.planKey) return input.planKey === rule.planKey ? 1 : 0;
  if (!rule.statKey) return 0;
  const value = input[rule.statKey];
  return typeof value === "number" ? value : 0;
}

function ruleTargetValue(rule: BadgeRule) {
  if (rule.planKey) return 1;
  return rule.threshold ?? 1;
}

function progressPercent(currentValue: number, targetValue: number, unlocked: boolean) {
  if (unlocked) return 100;
  if (targetValue <= 0) return 0;
  return Math.max(0, Math.min(99, Math.round((currentValue / targetValue) * 1000) / 10));
}

function lockedReason(rule: BadgeRule) {
  if (rule.manualOnly || rule.protectedAward) return "Protected badge. It can only be awarded by DZN admin, season, event, or crown logic.";
  if (rule.futureSupported) return "Progress source is not available yet.";
  return rule.requirementLabel;
}

function selectHighestBadge(badges: VisualBadge[]) {
  return sortBadges(badges)[0] ?? null;
}

function sortBadges<T extends VisualBadge>(badges: T[]) {
  return [...badges].sort((a, b) => badgeWeight(b) - badgeWeight(a) || dateValue(b.earnedAt) - dateValue(a.earnedAt) || a.name.localeCompare(b.name));
}

function sortLockedBadges(badges: PublicLockedBadge[]) {
  return [...badges].sort((a, b) => b.progressPercent - a.progressPercent || badgeWeight(b) - badgeWeight(a) || a.name.localeCompare(b.name));
}

function badgeWeight(badge: VisualBadge) {
  const visual = getBadgeVisualConfig(badge.code, badge.category, badge.name);
  const categoryWeight =
    badge.category === "crown" ? 10000 :
    badge.category === "reputation" ? 9000 :
    badge.category === "premium" ? 8500 :
    badge.category === "seasonal" ? 7500 :
    badge.category === "founder" ? 7000 :
    0;
  return categoryWeight + visual.sortOrder + rarityWeight(visual.rarity) * 100;
}

function rarityWeight(rarity: BadgeRarity) {
  const weights: Record<BadgeRarity, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
    mythic: 6,
    limited: 7,
    seasonal: 8,
    premium: 9,
    crown: 10,
  };
  return weights[rarity] ?? 0;
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function numberOrZero(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function humanizeBadgeName(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
