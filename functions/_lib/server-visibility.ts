import { getPlanVisibilityWeight as centralPlanVisibilityWeight, normalizePlanKey } from "./plans";

export type VisibilityTier = "standard" | "enhanced" | "premium";

export type VisibilityExplanation = {
  summary: string;
  factors: string[];
  fairness: string;
};

export type VisibilityCompletenessItem = {
  key: string;
  label: string;
  complete: boolean;
  action: string;
};

export type VisibilityCompleteness = {
  percent: number;
  completed: number;
  total: number;
  items: VisibilityCompletenessItem[];
};

export type ServerVisibilityConfig = {
  planKey: "free" | "starter" | "pro" | "premium";
  visibilityWeight: number;
  visibilityTier: VisibilityTier;
  isFeaturedEligible: boolean;
  isSpotlightEligible: boolean;
  isPriorityDiscovery: boolean;
  hasPremiumVisualTreatment: boolean;
  label: string;
};

export type ServerVisibilityInput = {
  plan_key?: unknown;
  planKey?: unknown;
  visibility_weight?: unknown;
  visibilityWeight?: unknown;
  stats_sync?: unknown;
  statsSync?: unknown;
  stats_sync_active?: unknown;
  statsSyncActive?: unknown;
  is_online?: unknown;
  isOnline?: unknown;
  current_players?: unknown;
  currentPlayers?: unknown;
  total_joins?: unknown;
  totalJoins?: unknown;
  unique_players?: unknown;
  uniquePlayers?: unknown;
  last_sync_at?: unknown;
  lastSyncAt?: unknown;
  metadata_last_checked_at?: unknown;
  metadataLastCheckedAt?: unknown;
  public_description?: unknown;
  publicDescription?: unknown;
  public_short_description?: unknown;
  publicShortDescription?: unknown;
  public_discord_invite?: unknown;
  publicDiscordInvite?: unknown;
  public_website_url?: unknown;
  publicWebsiteUrl?: unknown;
  tags?: unknown;
  tags_json?: unknown;
  reputation?: { tier?: unknown; score?: unknown } | null;
  reputationTier?: unknown;
  badges?: unknown;
  earnedBadges?: unknown;
  showcaseBadges?: unknown;
  crowns?: unknown;
  visualLoadout?: {
    source?: unknown;
    showcaseBadgeCodes?: unknown;
    profileFrameKey?: unknown;
    themeBannerKey?: unknown;
    animationEnabled?: unknown;
    cardStyle?: unknown;
  } | null;
};

export type OwnerVisibilityCompletenessInput = ServerVisibilityInput & {
  public_slug?: unknown;
  publicSlug?: unknown;
  server_category?: unknown;
  serverCategory?: unknown;
  listing_visibility?: unknown;
  listingVisibility?: unknown;
  savedVisualLoadout?: unknown;
  profileFrameKey?: unknown;
  themeBannerKey?: unknown;
  animationEnabled?: unknown;
  selectedShowcaseBadges?: unknown;
  earnedShowcaseBadges?: unknown;
  maxShowcaseBadges?: unknown;
  animationsAllowed?: unknown;
};

export function getPlanVisibilityWeight(planKey: unknown) {
  const normalized = normalizePlanKey(planKey);
  if (normalized === "free") return 0;
  return centralPlanVisibilityWeight(normalized);
}

export function getServerVisibilityConfig(server: ServerVisibilityInput | unknown): ServerVisibilityConfig {
  const planKey = normalizePublicPlanKey(planValue(server));
  const visibilityWeight = getPlanVisibilityWeight(planKey);
  if (planKey === "premium") {
    return {
      planKey,
      visibilityWeight,
      visibilityTier: "premium",
      isFeaturedEligible: true,
      isSpotlightEligible: true,
      isPriorityDiscovery: true,
      hasPremiumVisualTreatment: true,
      label: "Premium discovery priority",
    };
  }
  if (planKey === "pro") {
    return {
      planKey,
      visibilityWeight,
      visibilityTier: "enhanced",
      isFeaturedEligible: true,
      isSpotlightEligible: false,
      isPriorityDiscovery: true,
      hasPremiumVisualTreatment: false,
      label: "Enhanced discovery",
    };
  }
  return {
    planKey,
    visibilityWeight,
    visibilityTier: "standard",
    isFeaturedEligible: false,
    isSpotlightEligible: false,
    isPriorityDiscovery: false,
    hasPremiumVisualTreatment: false,
    label: "Standard listing",
  };
}

export function getServerDiscoveryScore(server: ServerVisibilityInput) {
  const config = getServerVisibilityConfig(server);
  const recentActivityScore = recentActivityPoints(server);
  const reputationScore = reputationPoints(server);
  const badgeScore = badgePoints(server);
  const profileScore = profileCompletenessPoints(server);
  const visualScore = visualCompletenessPoints(server);
  const activeScore = activeStatusPoints(server);
  return Math.round(
    config.visibilityWeight * 120 +
    recentActivityScore +
    reputationScore +
    badgeScore +
    profileScore +
    visualScore +
    activeScore,
  );
}

export function getFeaturedServerCandidates<T extends ServerVisibilityInput>(options: { servers: T[]; limit?: number }) {
  return orderedByDiscovery(options.servers.filter((server) => getServerVisibilityConfig(server).isFeaturedEligible), options.limit);
}

export function getSpotlightEligibleServers<T extends ServerVisibilityInput>(options: { servers: T[]; limit?: number }) {
  return orderedByDiscovery(options.servers.filter((server) => getServerVisibilityConfig(server).isSpotlightEligible), options.limit);
}

export function getRecommendedServers<T extends ServerVisibilityInput>(options: { servers: T[]; limit?: number }) {
  return orderedByDiscovery(options.servers, options.limit);
}

export function explainServerVisibility(server: ServerVisibilityInput): VisibilityExplanation {
  const config = getServerVisibilityConfig(server);
  const factors = [
    `${config.label} (weight ${config.visibilityWeight})`,
    activeStatusPoints(server) > 0 ? "Active server status" : "Standard activity status",
    profileCompletenessPoints(server) >= 30 ? "Complete public profile" : "Basic public profile",
    badgePoints(server) > 0 ? "Earned public badges" : "No earned badge boost yet",
    visualCompletenessPoints(server) > 0 ? "Visual loadout configured" : "Default visual loadout",
  ];
  return {
    summary: `${config.visibilityTier === "premium" ? "Premium" : config.visibilityTier === "enhanced" ? "Enhanced" : "Standard"} visibility for discovery surfaces.`,
    factors,
    fairness: "Visibility affects discovery, featured, recommended, and spotlight placement only. It does not change competitive leaderboard rank, kills, deaths, K/D, longest kill, crowns, tournament score, or ADM stats.",
  };
}

export function getProfileCompleteness(server: OwnerVisibilityCompletenessInput): VisibilityCompleteness {
  return completenessFromItems([
    {
      key: "category",
      label: "Server category",
      complete: Boolean(stringValue(server.server_category ?? server.serverCategory)),
      action: "Set a server category for category-matched discovery.",
    },
    {
      key: "description",
      label: "Public description",
      complete: Boolean(stringValue(server.public_description ?? server.publicDescription)),
      action: "Add a public description that explains the community.",
    },
    {
      key: "tags",
      label: "Listing tags",
      complete: countItems(server.tags ?? parseTags(server.tags_json)) > 0,
      action: "Add public tags so players can scan the listing quickly.",
    },
    {
      key: "public_page",
      label: "Public profile URL",
      complete: Boolean(stringValue(server.public_slug ?? server.publicSlug)),
      action: "Finish listing setup so the public profile URL is ready.",
    },
    {
      key: "visibility",
      label: "Public listing visibility",
      complete: String(server.listing_visibility ?? server.listingVisibility ?? "public").toLowerCase() !== "hidden",
      action: "Make the server public to participate in discovery surfaces.",
    },
  ]);
}

export function getVisualLoadoutCompleteness(server: OwnerVisibilityCompletenessInput): VisibilityCompleteness {
  const animationsAllowed = Boolean(server.animationsAllowed);
  const visualLoadout = server.visualLoadout;
  const saved = Boolean(server.savedVisualLoadout || visualLoadout?.source === "saved");
  return completenessFromItems([
    {
      key: "saved_loadout",
      label: "Saved visual loadout",
      complete: saved,
      action: "Save a visual loadout for the public card and profile header.",
    },
    {
      key: "profile_frame",
      label: "Profile frame",
      complete: Boolean(stringValue(server.profileFrameKey ?? visualLoadout?.profileFrameKey)),
      action: "Choose an available profile frame.",
    },
    {
      key: "theme_banner",
      label: "Theme banner",
      complete: Boolean(stringValue(server.themeBannerKey ?? visualLoadout?.themeBannerKey)),
      action: "Choose an available theme banner.",
    },
    {
      key: "animation",
      label: "Animation setting",
      complete: !animationsAllowed || Boolean(server.animationEnabled ?? visualLoadout?.animationEnabled),
      action: "Enable Premium animation when available.",
    },
  ]);
}

export function getBadgeShowcaseCompleteness(server: OwnerVisibilityCompletenessInput): VisibilityCompleteness {
  const selected = countItems(server.selectedShowcaseBadges ?? server.visualLoadout?.showcaseBadgeCodes);
  const earned = countItems(server.earnedShowcaseBadges ?? server.showcaseBadges ?? server.badges ?? server.earnedBadges);
  const maxShowcaseBadges = Math.max(1, numberValue(server.maxShowcaseBadges) || 3);
  const target = Math.max(1, Math.min(maxShowcaseBadges, Math.max(earned, 1)));
  return {
    percent: Math.min(100, Math.round((selected / target) * 100)),
    completed: selected,
    total: target,
    items: [
      {
        key: "earned_badges",
        label: "Earned public badges",
        complete: earned > 0,
        action: "Earn badges through reputation, activity, seasonal, or status rewards.",
      },
      {
        key: "selected_showcase",
        label: "Selected showcase badges",
        complete: selected > 0,
        action: "Choose earned badges for the public showcase.",
      },
      {
        key: "plan_allowance",
        label: "Showcase allowance used",
        complete: selected >= target,
        action: `Use up to ${maxShowcaseBadges} showcase badges on this plan.`,
      },
    ],
  };
}

export function getVisibilityUpgradeBenefits(planKey: unknown) {
  const normalized = normalizePublicPlanKey(planKey);
  if (normalized === "premium") return [];
  if (normalized === "pro") {
    return [
      "Premium adds spotlight eligibility.",
      "Premium adds premium discovery priority.",
      "Premium unlocks premium visual treatment for public cards and profiles.",
    ];
  }
  return [
    "Pro adds enhanced discovery and featured rotation eligibility.",
    "Premium adds premium discovery priority and spotlight eligibility.",
    "Premium unlocks premium visual treatment for public cards and profiles.",
  ];
}

export function getOwnerVisibilityRecommendedActions(input: {
  planKey: unknown;
  profileCompleteness: VisibilityCompleteness;
  visualLoadoutCompleteness: VisibilityCompleteness;
  badgeShowcaseCompleteness: VisibilityCompleteness;
  isSpotlightEligible?: boolean;
}) {
  const actions: string[] = [];
  if (input.profileCompleteness.percent < 100) actions.push("Complete public profile fields for stronger discovery quality.");
  if (input.visualLoadoutCompleteness.percent < 100) actions.push("Save a visual loadout so public cards look more complete.");
  if (input.badgeShowcaseCompleteness.percent < 100) actions.push("Add earned badges to the showcase when available.");

  const normalized = normalizePublicPlanKey(input.planKey);
  if (normalized === "starter") actions.push("Upgrade to Pro for enhanced discovery or Premium for spotlight eligibility.");
  if (normalized === "pro") actions.push("Upgrade to Premium for spotlight eligibility and premium discovery priority.");
  if (normalized === "premium" && input.isSpotlightEligible) actions.push("Premium spotlight eligibility is active; keep profile and activity quality high.");

  return actions.length ? actions : ["Visibility setup looks complete. Keep server activity and profile quality current."];
}

function orderedByDiscovery<T extends ServerVisibilityInput>(servers: T[], limit = 10) {
  return [...servers]
    .sort((a, b) => getServerDiscoveryScore(b) - getServerDiscoveryScore(a))
    .slice(0, Math.max(0, limit));
}

function normalizePublicPlanKey(value: unknown): "free" | "starter" | "pro" | "premium" {
  const normalized = normalizePlanKey(value);
  if (normalized === "premium" || normalized === "pro" || normalized === "starter") return normalized;
  return "starter";
}

function planValue(server: unknown) {
  if (!server || typeof server !== "object") return null;
  const record = server as ServerVisibilityInput;
  return record.plan_key ?? record.planKey;
}

function recentActivityPoints(server: ServerVisibilityInput) {
  const joins = Math.min(numberValue(server.total_joins ?? server.totalJoins) / 25, 40);
  const uniquePlayers = Math.min(numberValue(server.unique_players ?? server.uniquePlayers) / 10, 50);
  const playersOnline = Math.min(numberValue(server.current_players ?? server.currentPlayers) * 4, 40);
  const recentTimestamp = dateValue(server.last_sync_at ?? server.lastSyncAt ?? server.metadata_last_checked_at ?? server.metadataLastCheckedAt);
  const recentSync = recentTimestamp > 0 && Date.now() - recentTimestamp < 48 * 60 * 60 * 1000 ? 25 : 0;
  return joins + uniquePlayers + playersOnline + recentSync;
}

function reputationPoints(server: ServerVisibilityInput) {
  const tier = String(server.reputation?.tier ?? server.reputationTier ?? "").toLowerCase();
  const tierScore: Record<string, number> = {
    bronze: 10,
    silver: 20,
    gold: 35,
    platinum: 50,
    diamond: 70,
    legendary: 90,
  };
  const score = Math.min(numberValue(server.reputation?.score) / 50, 80);
  return (tierScore[tier] ?? 0) + score;
}

function badgePoints(server: ServerVisibilityInput) {
  return Math.min(countItems(server.crowns) * 16 + countItems(server.showcaseBadges ?? server.badges ?? server.earnedBadges) * 6, 72);
}

function profileCompletenessPoints(server: ServerVisibilityInput) {
  let points = 0;
  if (stringValue(server.public_description ?? server.publicDescription)) points += 18;
  if (stringValue(server.public_short_description ?? server.publicShortDescription)) points += 12;
  if (stringValue(server.public_discord_invite ?? server.publicDiscordInvite)) points += 10;
  if (stringValue(server.public_website_url ?? server.publicWebsiteUrl)) points += 10;
  if (countItems(server.tags ?? parseTags(server.tags_json)) > 0) points += 10;
  return points;
}

function visualCompletenessPoints(server: ServerVisibilityInput) {
  const visualLoadout = server.visualLoadout;
  if (!visualLoadout) return 0;
  let points = 0;
  if (visualLoadout.source === "saved") points += 14;
  if (countItems(visualLoadout.showcaseBadgeCodes) > 0) points += 12;
  if (stringValue(visualLoadout.profileFrameKey) && visualLoadout.profileFrameKey !== "bronze") points += 8;
  if (stringValue(visualLoadout.themeBannerKey) && visualLoadout.themeBannerKey !== "apocalypse") points += 8;
  if (visualLoadout.animationEnabled) points += 8;
  return points;
}

function activeStatusPoints(server: ServerVisibilityInput) {
  const syncStatus = String(server.stats_sync ?? server.statsSync ?? "").toLowerCase();
  const syncActive = Boolean(server.stats_sync_active ?? server.statsSyncActive) || syncStatus === "active";
  const online = Boolean(server.is_online ?? server.isOnline);
  return (syncActive ? 45 : 0) + (online ? 20 : 0);
}

function countItems(value: unknown) {
  if (Array.isArray(value)) return value.length;
  return 0;
}

function parseTags(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function completenessFromItems(items: VisibilityCompletenessItem[]): VisibilityCompleteness {
  const completed = items.filter((item) => item.complete).length;
  const total = Math.max(1, items.length);
  return {
    percent: Math.round((completed / total) * 100),
    completed,
    total,
    items,
  };
}
