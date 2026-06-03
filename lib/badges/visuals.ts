import { getPlanVisibilityWeight, hasPlanFeature, normalizePlanKey, type NormalizedPlanKey } from "../billing/plans";

export type BadgeRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic" | "limited" | "seasonal" | "crown" | "premium";
export type BadgeAnimationType = "none" | "glow" | "pulse" | "shimmer" | "sparks" | "flame" | "electric" | "crown" | "seasonal" | "legendary" | "premium";
export type BadgeDisplaySize = "sm" | "md" | "lg" | "xl";
export type BadgeUnlockType = "earned" | "reputation" | "crown" | "seasonal" | "founder" | "plan" | "event" | "admin";

export type BadgeVisualConfig = {
  staticIconUrl: string | null;
  animatedIconUrl: string | null;
  imageAlt: string;
  rarity: BadgeRarity;
  theme: string;
  glowColour: string;
  animationType: BadgeAnimationType;
  sortOrder: number;
  isShowcaseBadge: boolean;
  isPublic: boolean;
  displaySize: BadgeDisplaySize;
  unlockType: BadgeUnlockType;
};

export type AchievementVisualSource = {
  key: string;
  name: string;
  category: string;
  description?: string;
  points?: number;
  permanent?: boolean;
  limitedAvailability?: boolean;
};

export type AchievementShowcaseVisualSource = {
  topEarnedBadges?: AchievementVisualSource[];
  crownBadges?: AchievementVisualSource[];
  seasonalTrophies?: AchievementVisualSource[];
  founderBadges?: AchievementVisualSource[];
  premiumBadges?: AchievementVisualSource[];
};

export type VisualBadge = BadgeVisualConfig & {
  code: string;
  name: string;
  category: string;
  description: string;
  points: number | null;
  permanent: boolean;
  earnedAt: string | null;
  locked: boolean;
};

export type ReputationVisual = BadgeVisualConfig & {
  key: string;
  tier: string;
  label: string;
};

export type CrownVisual = BadgeVisualConfig & {
  key: string;
  label: string;
};

export type SeasonalVisual = BadgeVisualConfig & {
  key: string;
  label: string;
};

export type ProfileFrameVisual = {
  key: string;
  label: string;
  description: string;
  animationType: BadgeAnimationType;
  glowColour: string;
  theme: string;
  imageOverlayUrl: string | null;
  isAnimated: boolean;
  eligibility: "earned" | "plan" | "standard" | "seasonal";
};

export type ServerThemeBannerVisual = {
  key: string;
  label: string;
  description: string;
  palette: string[];
  backgroundUrl: string | null;
  fallbackGradient: string;
  publicPreview: boolean;
  ownerPreview: boolean;
};

export type PlanVisualTreatment = {
  planKey: NormalizedPlanKey;
  label: string;
  visibilityWeight: number;
  publicPublishingLabel: string;
  cardTreatment: "standard" | "pro" | "premium";
  premiumBadgeEligible: boolean;
  animatedFrameEligible: boolean;
  customThemeEligible: boolean;
  spotlightEligible: boolean;
};

export type ServerVisualInput = {
  planKey?: unknown;
  reputationTier?: string | null;
  category?: string | null;
  mapName?: string | null;
  achievementShowcase?: AchievementShowcaseVisualSource | null;
  preferredFrameKey?: string | null;
  preferredThemeKey?: string | null;
  maxBadges?: number;
};

const DEFAULT_GLOW = "#22d3ee";

const CATEGORY_DEFAULTS: Record<string, Partial<BadgeVisualConfig>> = {
  combat: { rarity: "rare", theme: "combat", glowColour: "#ef4444", animationType: "pulse", unlockType: "earned" },
  community: { rarity: "uncommon", theme: "community", glowColour: "#22d3ee", animationType: "glow", unlockType: "earned" },
  growth: { rarity: "rare", theme: "growth", glowColour: "#34d399", animationType: "shimmer", unlockType: "earned" },
  activity: { rarity: "uncommon", theme: "activity", glowColour: "#a78bfa", animationType: "pulse", unlockType: "earned" },
  founder: { rarity: "limited", theme: "founder", glowColour: "#f59e0b", animationType: "legendary", unlockType: "founder" },
  seasonal: { rarity: "seasonal", theme: "seasonal", glowColour: "#38bdf8", animationType: "seasonal", unlockType: "seasonal" },
  premium: { rarity: "premium", theme: "premium", glowColour: "#facc15", animationType: "premium", unlockType: "plan" },
  legendary: { rarity: "legendary", theme: "legendary", glowColour: "#f59e0b", animationType: "legendary", unlockType: "earned" },
  crown: { rarity: "crown", theme: "crown", glowColour: "#f59e0b", animationType: "crown", unlockType: "crown" },
  reputation: { rarity: "common", theme: "reputation", glowColour: "#22d3ee", animationType: "glow", unlockType: "reputation" },
};

const BADGE_VISUALS: Record<string, Partial<BadgeVisualConfig> & { label?: string }> = {
  bronze: visual("reputation", "bronze", "Bronze Reputation", "common", "#cd7f32", "glow", 10),
  silver: visual("reputation", "silver", "Silver Reputation", "uncommon", "#cbd5e1", "glow", 20),
  gold: visual("reputation", "gold", "Gold Reputation", "rare", "#facc15", "shimmer", 30),
  platinum: visual("reputation", "platinum", "Platinum Reputation", "epic", "#93c5fd", "electric", 40),
  diamond: visual("reputation", "diamond", "Diamond Reputation", "legendary", "#67e8f9", "legendary", 50),
  legendary: visual("reputation", "legendary", "Legendary Reputation", "mythic", "#c084fc", "legendary", 60),

  premium_server: visual("premium", "premium-server", "Premium Server", "premium", "#facc15", "premium", 110),
  verified_server: visual("premium", "verified-server", "Verified Server", "rare", "#22d3ee", "glow", 102),
  featured_server: visual("premium", "featured-server", "Featured Server", "premium", "#f59e0b", "shimmer", 106),
  trending_server: visual("premium", "trending-server", "Trending Server", "epic", "#fb7185", "pulse", 96),
  top_pick: visual("premium", "top-pick", "Top Pick", "epic", "#a78bfa", "sparks", 97),
  rising_server: visual("premium", "rising-server", "Rising Server", "rare", "#34d399", "pulse", 80),
  community_favourite: visual("premium", "community-favourite", "Community Favourite", "epic", "#f472b6", "sparks", 92),

  king_of_pvp: visual("crowns", "king-of-pvp", "King of PvP", "crown", "#f59e0b", "crown", 300),
  king_of_survival: visual("crowns", "king-of-survival", "King of Survival", "crown", "#34d399", "crown", 300),
  king_of_deathmatch: visual("crowns", "king-of-deathmatch", "King of Deathmatch", "crown", "#ef4444", "crown", 300),
  king_of_pve: visual("crowns", "king-of-pve", "King of PvE", "crown", "#22d3ee", "crown", 300),
  king_of_dzn: visual("crowns", "king-of-dzn", "King of DZN", "mythic", "#facc15", "legendary", 340),

  death_dealer: visual("combat", "death-dealer", "Death Dealer", "rare", "#ef4444", "pulse", 70),
  headhunter: visual("combat", "headhunter", "Headhunter", "epic", "#fb7185", "sparks", 90),
  long_shot_legend: visual("combat", "long-shot-legend", "Long Shot Legend", "legendary", "#f59e0b", "shimmer", 100),
  marksman: visual("combat", "long-shot-legend", "Long Shot Legend", "legendary", "#f59e0b", "shimmer", 100),
  warlord: visual("combat", "warlord", "Warlord", "legendary", "#dc2626", "flame", 120),
  hot_streak: visual("combat", "hot-streak", "Hot Streak", "epic", "#f97316", "flame", 85),

  trusted_server: visual("community", "trusted-server", "Trusted Server", "rare", "#22d3ee", "glow", 74),
  trusted_node: visual("community", "trusted-server", "Trusted Server", "rare", "#22d3ee", "glow", 74),
  team_player: visual("community", "team-player", "Team Player", "uncommon", "#38bdf8", "pulse", 62),
  helping_hand: visual("community", "helping-hand", "Helping Hand", "uncommon", "#34d399", "glow", 64),
  loot_master: visual("community", "loot-master", "Loot Master", "rare", "#a78bfa", "shimmer", 70),
  event_champion: visual("community", "event-champion", "Event Champion", "legendary", "#facc15", "legendary", 130),

  founder: visual("legendary", "founder", "Founder", "limited", "#f59e0b", "legendary", 250),
  early_adopter: visual("legendary", "early-adopter", "Early Adopter", "limited", "#22d3ee", "shimmer", 230),
  beta_veteran: visual("legendary", "beta-veteran", "Beta Veteran", "limited", "#a78bfa", "electric", 240),
  legacy_server: visual("legendary", "legacy-server", "Legacy Server", "limited", "#facc15", "legendary", 245),

  spring_champion: visual("seasonal", "spring-champion", "Spring Champion", "seasonal", "#86efac", "seasonal", 200),
  summer_champion: visual("seasonal", "summer-champion", "Summer Champion", "seasonal", "#facc15", "seasonal", 205),
  autumn_champion: visual("seasonal", "autumn-champion", "Autumn Champion", "seasonal", "#fb923c", "seasonal", 210),
  winter_champion: visual("seasonal", "winter-champion", "Winter Champion", "seasonal", "#93c5fd", "seasonal", 215),
  halloween_champion: visual("seasonal", "halloween-champion", "Halloween Champion", "seasonal", "#f97316", "flame", 218),
  christmas_champion: visual("seasonal", "christmas-champion", "Christmas Champion", "seasonal", "#ef4444", "seasonal", 219),
  easter_champion: visual("seasonal", "easter-champion", "Easter Champion", "seasonal", "#f9a8d4", "seasonal", 220),
};

const FRAME_VISUALS: Record<string, ProfileFrameVisual> = {
  premium: frame("premium", "Premium Frame", "Animated premium frame for high-visibility DZN servers.", "#facc15", "premium", "premium", true, "plan"),
  platinum: frame("platinum", "Platinum Frame", "Clean high-trust frame for platinum reputation.", "#93c5fd", "electric", "reputation", true, "earned"),
  diamond: frame("diamond", "Diamond Frame", "Bright diamond reputation frame.", "#67e8f9", "legendary", "reputation", true, "earned"),
  emerald: frame("emerald", "Emerald Frame", "Growth and community reputation frame.", "#34d399", "glow", "reputation", false, "earned"),
  gold: frame("gold", "Gold Frame", "Gold reputation frame.", "#facc15", "shimmer", "reputation", false, "earned"),
  silver: frame("silver", "Silver Frame", "Silver reputation frame.", "#cbd5e1", "glow", "reputation", false, "earned"),
  bronze: frame("bronze", "Bronze Frame", "Starter reputation frame.", "#cd7f32", "none", "reputation", false, "standard"),
  legendary: frame("legendary", "Legendary Frame", "Elite animated DZN frame.", "#c084fc", "legendary", "legendary", true, "earned"),
  neon: frame("neon", "Neon Frame", "Cyber-styled public profile frame.", "#22d3ee", "electric", "neon", true, "plan"),
  toxic: frame("toxic", "Toxic Zone Frame", "Green toxic zone profile frame.", "#84cc16", "glow", "toxic", true, "earned"),
  fire: frame("fire", "Fire Frame", "Combat flame profile frame.", "#ef4444", "flame", "combat", true, "earned"),
  ice: frame("ice", "Ice Frame", "Winter seasonal profile frame.", "#93c5fd", "seasonal", "seasonal", true, "seasonal"),
  space: frame("space", "Space Frame", "Deep-space visual frame.", "#a78bfa", "legendary", "space", true, "plan"),
  seasonal: frame("seasonal", "Seasonal Frame", "Current seasonal event profile frame.", "#38bdf8", "seasonal", "seasonal", true, "seasonal"),
};

const THEME_BANNERS: Record<string, ServerThemeBannerVisual> = {
  apocalypse: theme("apocalypse", "Apocalypse", "Dark survival banner with burnt orange highlights.", ["#020617", "#7c2d12", "#f97316"], "/themes/apocalypse.webp", "linear-gradient(135deg, rgba(2,6,23,0.95), rgba(88,28,12,0.72), rgba(249,115,22,0.22))"),
  chernarus: theme("chernarus", "Chernarus", "Forest survival banner for classic DayZ servers.", ["#02130f", "#14532d", "#22c55e"], "/themes/chernarus.webp", "linear-gradient(135deg, rgba(2,19,15,0.96), rgba(20,83,45,0.68), rgba(34,197,94,0.18))"),
  winter: theme("winter", "Winter", "Cold blue seasonal banner.", ["#020617", "#1e3a8a", "#93c5fd"], "/themes/winter.webp", "linear-gradient(135deg, rgba(2,6,23,0.96), rgba(30,58,138,0.72), rgba(147,197,253,0.22))"),
  desert: theme("desert", "Desert", "Dry survival banner with sand and amber tones.", ["#180f05", "#92400e", "#f59e0b"], "/themes/desert.webp", "linear-gradient(135deg, rgba(24,15,5,0.96), rgba(146,64,14,0.72), rgba(245,158,11,0.18))"),
  neon_city: theme("neon_city", "Neon City", "High-energy neon banner for deathmatch servers.", ["#020617", "#7c3aed", "#22d3ee"], "/themes/neon-city.webp", "linear-gradient(135deg, rgba(2,6,23,0.95), rgba(124,58,237,0.64), rgba(34,211,238,0.2))"),
  toxic_zone: theme("toxic_zone", "Toxic Zone", "Green danger-zone banner.", ["#020617", "#365314", "#a3e635"], "/themes/toxic-zone.webp", "linear-gradient(135deg, rgba(2,6,23,0.96), rgba(54,83,20,0.72), rgba(163,230,53,0.2))"),
  island: theme("island", "Island", "Coastal island server banner.", ["#031827", "#0e7490", "#67e8f9"], "/themes/island.webp", "linear-gradient(135deg, rgba(3,24,39,0.96), rgba(14,116,144,0.7), rgba(103,232,249,0.18))"),
  space: theme("space", "Space", "Deep-space premium profile banner.", ["#020617", "#4c1d95", "#a78bfa"], "/themes/space.webp", "linear-gradient(135deg, rgba(2,6,23,0.96), rgba(76,29,149,0.72), rgba(167,139,250,0.22))"),
  military: theme("military", "Military", "Restrained tactical banner.", ["#020617", "#1f2937", "#84cc16"], "/themes/military.webp", "linear-gradient(135deg, rgba(2,6,23,0.96), rgba(31,41,55,0.78), rgba(132,204,22,0.16))"),
  night_ops: theme("night_ops", "Night Ops", "Low-light stealth banner.", ["#020617", "#0f172a", "#38bdf8"], "/themes/night-ops.webp", "linear-gradient(135deg, rgba(2,6,23,0.98), rgba(15,23,42,0.84), rgba(56,189,248,0.16))"),
};

export function getBadgeVisualConfig(code: string, category?: string | null, name?: string | null): BadgeVisualConfig {
  const key = normalizeBadgeKey(code);
  const baseKey = baseBadgeKey(key);
  const visualKey = BADGE_VISUALS[key] ? key : BADGE_VISUALS[baseKey] ? baseKey : key;
  const specific = BADGE_VISUALS[visualKey] ?? {};
  const defaultCategory = categoryKey(category ?? specific.theme ?? inferBadgeCategory(visualKey));
  const defaults = CATEGORY_DEFAULTS[defaultCategory] ?? CATEGORY_DEFAULTS.community;
  const label = specific.label ?? name ?? humanizeBadgeName(baseKey);
  return {
    staticIconUrl: specific.staticIconUrl ?? defaults.staticIconUrl ?? badgeAssetPath(defaultCategory, baseKey, false),
    animatedIconUrl: specific.animatedIconUrl ?? defaults.animatedIconUrl ?? badgeAssetPath(defaultCategory, baseKey, true),
    imageAlt: specific.imageAlt ?? defaults.imageAlt ?? `${label} badge`,
    rarity: (specific.rarity ?? defaults.rarity ?? "common") as BadgeRarity,
    theme: specific.theme ?? defaults.theme ?? defaultCategory,
    glowColour: specific.glowColour ?? defaults.glowColour ?? DEFAULT_GLOW,
    animationType: (specific.animationType ?? defaults.animationType ?? "none") as BadgeAnimationType,
    sortOrder: specific.sortOrder ?? defaults.sortOrder ?? 0,
    isShowcaseBadge: specific.isShowcaseBadge ?? defaults.isShowcaseBadge ?? true,
    isPublic: specific.isPublic ?? defaults.isPublic ?? true,
    displaySize: (specific.displaySize ?? defaults.displaySize ?? "md") as BadgeDisplaySize,
    unlockType: (specific.unlockType ?? defaults.unlockType ?? "earned") as BadgeUnlockType,
  };
}

export function toVisualBadge(source: AchievementVisualSource, options: { earnedAt?: string | null; locked?: boolean } = {}): VisualBadge {
  const code = normalizeBadgeKey(source.key);
  const category = inferVisualCategory(code, source.category);
  const visual = getBadgeVisualConfig(code, category, source.name);
  return {
    code,
    name: source.name,
    category,
    description: source.description ?? `${source.name} badge.`,
    points: typeof source.points === "number" ? source.points : null,
    permanent: source.permanent !== false,
    earnedAt: options.earnedAt ?? null,
    locked: Boolean(options.locked),
    ...visual,
  };
}

export function getReputationVisual(tier: string | null | undefined): ReputationVisual {
  const key = normalizeBadgeKey(tier || "bronze");
  const normalized = ["bronze", "silver", "gold", "platinum", "diamond", "legendary"].includes(key) ? key : "bronze";
  return {
    key: normalized,
    tier: titleCase(normalized),
    label: `${titleCase(normalized)} Reputation`,
    ...getBadgeVisualConfig(normalized, "reputation", `${titleCase(normalized)} Reputation`),
  };
}

export function getCrownVisual(crownKey: string): CrownVisual {
  const key = normalizeBadgeKey(crownKey);
  return {
    key,
    label: humanizeBadgeName(key),
    ...getBadgeVisualConfig(key, "crown", humanizeBadgeName(key)),
  };
}

export function getSeasonalVisual(seasonalKey: string): SeasonalVisual {
  const key = baseBadgeKey(normalizeBadgeKey(seasonalKey));
  return {
    key,
    label: humanizeBadgeName(key),
    ...getBadgeVisualConfig(key, "seasonal", humanizeBadgeName(key)),
  };
}

export function getPlanVisualTreatment(planKey: unknown): PlanVisualTreatment {
  const plan = normalizePlanKey(planKey);
  const premium = hasPlanFeature(plan, "premium_badge");
  const pro = plan === "pro";
  return {
    planKey: plan,
    label: plan === "premium" ? "Premium" : plan === "pro" ? "Pro" : plan === "starter" ? "Starter" : "Free",
    visibilityWeight: getPlanVisibilityWeight(plan),
    publicPublishingLabel: plan === "premium" ? "near real time" : plan === "pro" ? "every 4 hours" : "every 24 hours",
    cardTreatment: premium ? "premium" : pro ? "pro" : "standard",
    premiumBadgeEligible: premium,
    animatedFrameEligible: premium,
    customThemeEligible: premium || pro,
    spotlightEligible: premium,
  };
}

export function getServerProfileFrame(input: ServerVisualInput): ProfileFrameVisual {
  const preferred = input.preferredFrameKey ? FRAME_VISUALS[normalizeBadgeKey(input.preferredFrameKey)] : null;
  if (preferred) return preferred;
  const plan = normalizePlanKey(input.planKey);
  if (plan === "premium") return FRAME_VISUALS.premium;
  const tierKey = normalizeBadgeKey(input.reputationTier || "bronze");
  if (tierKey === "legendary") return FRAME_VISUALS.legendary;
  if (tierKey === "diamond") return FRAME_VISUALS.diamond;
  if (tierKey === "platinum") return FRAME_VISUALS.platinum;
  if (tierKey === "gold") return FRAME_VISUALS.gold;
  if (tierKey === "silver") return FRAME_VISUALS.silver;
  return FRAME_VISUALS.bronze;
}

export function getServerThemeBanner(input: ServerVisualInput): ServerThemeBannerVisual {
  const preferred = input.preferredThemeKey ? THEME_BANNERS[normalizeBadgeKey(input.preferredThemeKey)] : null;
  if (preferred) return preferred;
  const plan = normalizePlanKey(input.planKey);
  const map = String(input.mapName ?? "").toLowerCase();
  const category = String(input.category ?? "").toLowerCase();
  if (plan === "premium") return THEME_BANNERS.space;
  if (map.includes("chernarus")) return THEME_BANNERS.chernarus;
  if (map.includes("winter") || map.includes("sakhal")) return THEME_BANNERS.winter;
  if (category.includes("deathmatch")) return THEME_BANNERS.neon_city;
  if (category.includes("pve")) return THEME_BANNERS.chernarus;
  if (category.includes("pvp")) return THEME_BANNERS.military;
  return THEME_BANNERS.apocalypse;
}

export function getServerShowcaseBadges(input: ServerVisualInput): VisualBadge[] {
  const max = Math.max(1, input.maxBadges ?? 8);
  const badges: VisualBadge[] = [];
  const showcase = input.achievementShowcase;
  const add = (badge: VisualBadge) => {
    if (!badge.isPublic || !badge.isShowcaseBadge) return;
    const baseCode = baseBadgeKey(badge.code);
    if (badges.some((existing) => existing.code === badge.code || (existing.category === badge.category && baseBadgeKey(existing.code) === baseCode))) return;
    badges.push(badge);
  };

  for (const badge of showcase?.crownBadges ?? []) add(toVisualBadge(badge));
  if (hasPlanFeature(input.planKey, "premium_badge")) {
    add(toVisualBadge({
      key: "premium_server",
      name: "Premium Server",
      category: "premium",
      description: "Premium DZN visual treatment and discovery eligibility.",
      points: 0,
      permanent: true,
    }));
  }
  const reputation = getReputationVisual(input.reputationTier);
  add({
    code: reputation.key,
    name: reputation.label,
    category: "reputation",
    description: `${reputation.label} tier.`,
    points: null,
    permanent: true,
    earnedAt: null,
    locked: false,
    ...reputation,
  });
  for (const badge of showcase?.seasonalTrophies ?? []) add(toVisualBadge(badge));
  for (const badge of showcase?.founderBadges ?? []) add(toVisualBadge(badge));
  for (const badge of showcase?.premiumBadges ?? []) add(toVisualBadge(badge));
  for (const badge of showcase?.topEarnedBadges ?? []) add(toVisualBadge(badge));

  return badges
    .sort((a, b) => badgeDisplayWeight(b) - badgeDisplayWeight(a) || a.name.localeCompare(b.name))
    .slice(0, max);
}

export function getLockedShowcaseBadges(input: ServerVisualInput): VisualBadge[] {
  const lockedKeys = ["king_of_dzn", "event_champion", "warlord", "long_shot_legend", "community_favourite"];
  const ownedCodes = new Set(getServerShowcaseBadges({ ...input, maxBadges: 24 }).map((badge) => badge.code));
  return lockedKeys
    .filter((key) => !ownedCodes.has(key))
    .map((key) => toVisualBadge({
      key,
      name: humanizeBadgeName(key),
      category: key.startsWith("king_") ? "legendary" : key === "community_favourite" ? "community" : "combat",
      description: "Locked visual reward. Earn it through DZN activity, events, or reputation.",
      permanent: true,
    }, { locked: true }));
}

export function getServerVisualShowcase(input: ServerVisualInput) {
  const planVisualTreatment = getPlanVisualTreatment(input.planKey);
  const profileFrame = getServerProfileFrame(input);
  const themeBanner = getServerThemeBanner(input);
  const badges = getServerShowcaseBadges(input);
  return {
    badges,
    profileFrame,
    themeBanner,
    planVisualTreatment,
  };
}

export function getAvailableFrameKeys() {
  return Object.keys(FRAME_VISUALS);
}

export function getAvailableThemeBannerKeys() {
  return Object.keys(THEME_BANNERS);
}

function visual(folder: string, slug: string, label: string, rarity: BadgeRarity, glowColour: string, animationType: BadgeAnimationType, sortOrder: number): Partial<BadgeVisualConfig> & { label: string } {
  return {
    label,
    staticIconUrl: `/badges/${folder}/${slug}.webp`,
    animatedIconUrl: `/badges/${folder}/${slug}-animated.webp`,
    imageAlt: `${label} badge`,
    rarity,
    theme: folder === "crowns" ? "crown" : folder,
    glowColour,
    animationType,
    sortOrder,
    isShowcaseBadge: true,
    isPublic: true,
    displaySize: rarity === "crown" || rarity === "mythic" ? "lg" : "md",
    unlockType: folder === "crowns" ? "crown" : folder === "seasonal" ? "seasonal" : folder === "premium" ? "plan" : folder === "reputation" ? "reputation" : "earned",
  };
}

function frame(key: string, label: string, description: string, glowColour: string, animationType: BadgeAnimationType, theme: string, isAnimated: boolean, eligibility: ProfileFrameVisual["eligibility"]): ProfileFrameVisual {
  return {
    key,
    label,
    description,
    animationType,
    glowColour,
    theme,
    imageOverlayUrl: `/frames/${key}.webp`,
    isAnimated,
    eligibility,
  };
}

function theme(key: string, label: string, description: string, palette: string[], backgroundUrl: string, fallbackGradient: string): ServerThemeBannerVisual {
  return {
    key,
    label,
    description,
    palette,
    backgroundUrl,
    fallbackGradient,
    publicPreview: true,
    ownerPreview: true,
  };
}

function badgeAssetPath(category: string, key: string, animated: boolean) {
  const folder = category === "crown" ? "crowns" : category === "founder" ? "legendary" : category;
  const slug = key.replace(/_/g, "-");
  return `/badges/${folder}/${slug}${animated ? "-animated" : ""}.webp`;
}

function normalizeBadgeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function baseBadgeKey(key: string) {
  const withoutTier = key.replace(/_\d+$/, "");
  return withoutTier.replace(/_(20\d{2})$/, "");
}

function inferBadgeCategory(key: string) {
  if (key.startsWith("king_of_")) return "crown";
  if (key.includes("champion")) return "seasonal";
  if (["bronze", "silver", "gold", "platinum", "diamond", "legendary"].includes(key)) return "reputation";
  return "community";
}

function inferVisualCategory(code: string, category: string) {
  if (code.startsWith("king_of_")) return "crown";
  const key = baseBadgeKey(code);
  if (BADGE_VISUALS[key]?.theme === "reputation") return "reputation";
  if (BADGE_VISUALS[key]?.theme === "seasonal") return "seasonal";
  return categoryKey(category);
}

function categoryKey(category: string | null | undefined) {
  const key = normalizeBadgeKey(category ?? "");
  if (key === "crowns") return "crown";
  return key || "community";
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

function badgeDisplayWeight(badge: VisualBadge) {
  const strategicWeight =
    badge.category === "crown" ? 1000 :
    badge.category === "premium" ? 900 :
    badge.category === "reputation" ? 940 :
    badge.category === "seasonal" ? 780 :
    badge.category === "founder" ? 720 :
    0;
  return strategicWeight + badge.sortOrder + rarityWeight(badge.rarity) * 5;
}

function humanizeBadgeName(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
