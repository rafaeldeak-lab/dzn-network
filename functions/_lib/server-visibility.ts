import { getPlanVisibilityWeight as centralPlanVisibilityWeight, normalizePlanKey } from "./plans";

export type VisibilityTier = "standard" | "enhanced" | "premium";

export type VisibilityExplanation = {
  summary: string;
  factors: string[];
  fairness: string;
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
