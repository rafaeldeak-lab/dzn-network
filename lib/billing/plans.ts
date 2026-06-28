export type PaidPlanKey = "starter" | "pro" | "premium";
export type LegacyPaidPlanKey = "network" | "partner";
export type NormalizedPlanKey = "free" | PaidPlanKey;
export type PlanKey = NormalizedPlanKey | LegacyPaidPlanKey;

export type PlanFeature =
  | "server_profile"
  | "basic_stats"
  | "basic_status"
  | "leaderboards"
  | "advanced_stats"
  | "server_visibility_boost"
  | "server_vs_server"
  | "event_leaderboards"
  | "network_rankings"
  | "public_network_listing"
  | "partner_placement"
  | "partner_badge"
  | "priority_visibility"
  | "priority_refresh"
  | "public_featured_listing"
  | "achievement_participation"
  | "seasonal_participation"
  | "featured_rotation"
  | "enhanced_discovery"
  | "profile_customization"
  | "enhanced_achievement_tracking"
  | "premium_badge"
  | "homepage_featured"
  | "priority_discovery"
  | "server_spotlight"
  | "premium_seasonal_rewards"
  | "premium_analytics"
  | "premium_reputation_multiplier"
  | "billing_portal"
  | "everything";

export type AutoPostType =
  | "server_advert"
  | "bump_announcement"
  | "fresh_wipe"
  | "event_announcement"
  | "leaderboard_update"
  | "longest_kill"
  | "rating_review"
  | "weekly_recap"
  | "milestone"
  | "basic_status_embed"
  | "leaderboard_embed"
  | "daily_summary_embed"
  | "event_leaderboard_embed"
  | "network_ranking_embed"
  | "server_vs_server_embed"
  | "killfeed_embed"
  | "pve_feed_embed"
  | "hit_feed_embed"
  | "connection_feed_embed"
  | "build_feed_embed"
  | "admin_alerts_embed"
  | "admin_logs_embed"
  | "partner_featured_embed"
  | "priority_status_embed";

export type BillingPlanConfig = {
  key: NormalizedPlanKey;
  name: string;
  monthly_price: number;
  stripe_price_env_key: string | null;
  server_status_interval_minutes: number;
  adm_discovery_interval_minutes: number;
  adm_pull_interval_minutes: number;
  manual_adm_refresh_cooldown_minutes: number;
  public_publish_interval_minutes: number;
  visibility_weight: number;
  allowed_features: PlanFeature[];
  allowed_auto_posts: AutoPostType[];
  priority_level: number;
};

export type ListingPlanKey = "free" | "pro";
export type ListingFeatureKey =
  | "public_listing"
  | "basic_profile"
  | "ratings_reviews"
  | "custom_banner"
  | "gallery_images"
  | "weekly_bump"
  | "discord_basic_embeds"
  | "discord_pro_embeds"
  | "owner_announcement"
  | "event_promotion"
  | "listing_analytics"
  | "pro_badge_frame";

export type ListingLimits = {
  listingPlanKey: ListingPlanKey;
  publicLabel: "Free Listing" | "Pro Listing";
  descriptionLimit: number;
  bumpCooldownDays: number;
  galleryLimit: number;
  galleryAllowedMimeTypes: readonly string[];
  galleryMaxFileSizeBytes: number;
  galleryRecommendedWidth: number;
  galleryRecommendedHeight: number;
  galleryAspectRatio: "16:9";
  discordChannelLimit: number | null;
  allowedAutoPosts: readonly AutoPostType[];
  enhancedDiscordEmbeds: boolean;
  customAdvertBanner: boolean;
  ownerAnnouncement: boolean;
  listingAnalytics: "limited" | "pro";
};

export type AutoPostOptionGroup = "Basic" | "Stats" | "Events" | "Feeds" | "Admin" | "Pro";
export type AutoPostOption = {
  key: AutoPostType;
  label: string;
  group: AutoPostOptionGroup;
  min_plan_key: PaidPlanKey;
  upgrade_label: string;
};

export const MIN_SERVER_STATUS_INTERVAL_MINUTES = 1;
export const MIN_ADM_DISCOVERY_INTERVAL_MINUTES = 3;
export const MIN_ADM_PULL_INTERVAL_MINUTES = 10;
export const FREE_DESCRIPTION_LIMIT = 500;
export const PRO_DESCRIPTION_LIMIT = 2500;
export const FREE_BUMP_COOLDOWN_DAYS = 30;
export const PRO_BUMP_COOLDOWN_DAYS = 7;
export const FREE_GALLERY_LIMIT = 0;
export const PRO_GALLERY_LIMIT = 4;
export const PRO_GALLERY_ALLOWED_MIME_TYPES = ["image/jpeg"] as const;
export const PRO_GALLERY_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
export const PRO_GALLERY_RECOMMENDED_WIDTH = 1280;
export const PRO_GALLERY_RECOMMENDED_HEIGHT = 720;
export const PRO_GALLERY_ASPECT_RATIO = "16:9";

export const FREE_LISTING_AUTO_POST_TYPES = [
  "server_advert",
  "bump_announcement",
  "rating_review",
  "basic_status_embed",
] as const satisfies readonly AutoPostType[];

export const PRO_LISTING_AUTO_POST_TYPES = [
  "server_advert",
  "bump_announcement",
  "fresh_wipe",
  "event_announcement",
  "leaderboard_update",
  "longest_kill",
  "rating_review",
  "weekly_recap",
  "milestone",
  "basic_status_embed",
  "leaderboard_embed",
  "daily_summary_embed",
  "event_leaderboard_embed",
  "network_ranking_embed",
  "server_vs_server_embed",
  "killfeed_embed",
  "pve_feed_embed",
  "hit_feed_embed",
  "connection_feed_embed",
  "build_feed_embed",
  "admin_alerts_embed",
  "admin_logs_embed",
  "partner_featured_embed",
  "priority_status_embed",
] as const satisfies readonly AutoPostType[];

export const LISTING_LIMITS: Record<ListingPlanKey, ListingLimits> = {
  free: {
    listingPlanKey: "free",
    publicLabel: "Free Listing",
    descriptionLimit: FREE_DESCRIPTION_LIMIT,
    bumpCooldownDays: FREE_BUMP_COOLDOWN_DAYS,
    galleryLimit: FREE_GALLERY_LIMIT,
    galleryAllowedMimeTypes: PRO_GALLERY_ALLOWED_MIME_TYPES,
    galleryMaxFileSizeBytes: PRO_GALLERY_MAX_FILE_SIZE_BYTES,
    galleryRecommendedWidth: PRO_GALLERY_RECOMMENDED_WIDTH,
    galleryRecommendedHeight: PRO_GALLERY_RECOMMENDED_HEIGHT,
    galleryAspectRatio: PRO_GALLERY_ASPECT_RATIO,
    discordChannelLimit: 1,
    allowedAutoPosts: FREE_LISTING_AUTO_POST_TYPES,
    enhancedDiscordEmbeds: false,
    customAdvertBanner: false,
    ownerAnnouncement: false,
    listingAnalytics: "limited",
  },
  pro: {
    listingPlanKey: "pro",
    publicLabel: "Pro Listing",
    descriptionLimit: PRO_DESCRIPTION_LIMIT,
    bumpCooldownDays: PRO_BUMP_COOLDOWN_DAYS,
    galleryLimit: PRO_GALLERY_LIMIT,
    galleryAllowedMimeTypes: PRO_GALLERY_ALLOWED_MIME_TYPES,
    galleryMaxFileSizeBytes: PRO_GALLERY_MAX_FILE_SIZE_BYTES,
    galleryRecommendedWidth: PRO_GALLERY_RECOMMENDED_WIDTH,
    galleryRecommendedHeight: PRO_GALLERY_RECOMMENDED_HEIGHT,
    galleryAspectRatio: PRO_GALLERY_ASPECT_RATIO,
    discordChannelLimit: null,
    allowedAutoPosts: PRO_LISTING_AUTO_POST_TYPES,
    enhancedDiscordEmbeds: true,
    customAdvertBanner: true,
    ownerAnnouncement: true,
    listingAnalytics: "pro",
  },
};

export const BILLING_PLAN_CONFIG: Record<NormalizedPlanKey, BillingPlanConfig> = {
  free: {
    key: "free",
    name: "DZN Free",
    monthly_price: 0,
    stripe_price_env_key: null,
    server_status_interval_minutes: 60,
    adm_discovery_interval_minutes: 60,
    adm_pull_interval_minutes: 1440,
    manual_adm_refresh_cooldown_minutes: 1440,
    public_publish_interval_minutes: 1440,
    visibility_weight: 0,
    allowed_features: ["server_profile", "basic_status"],
    allowed_auto_posts: [...FREE_LISTING_AUTO_POST_TYPES],
    priority_level: 0,
  },
  starter: {
    key: "starter",
    name: "Starter",
    monthly_price: 4.99,
    stripe_price_env_key: "STRIPE_PRICE_STARTER",
    server_status_interval_minutes: 7,
    adm_discovery_interval_minutes: 15,
    adm_pull_interval_minutes: 60,
    manual_adm_refresh_cooldown_minutes: 60,
    public_publish_interval_minutes: 1440,
    visibility_weight: 1,
    allowed_features: [
      "server_profile",
      "basic_stats",
      "basic_status",
      "leaderboards",
      "achievement_participation",
      "seasonal_participation",
      "billing_portal",
    ],
    allowed_auto_posts: [...FREE_LISTING_AUTO_POST_TYPES],
    priority_level: 1,
  },
  pro: {
    key: "pro",
    name: "Pro",
    monthly_price: 9.99,
    stripe_price_env_key: "STRIPE_PRICE_PRO",
    server_status_interval_minutes: 5,
    adm_discovery_interval_minutes: 10,
    adm_pull_interval_minutes: 30,
    manual_adm_refresh_cooldown_minutes: 30,
    public_publish_interval_minutes: 240,
    visibility_weight: 2,
    allowed_features: [
      "server_profile",
      "basic_stats",
      "basic_status",
      "leaderboards",
      "advanced_stats",
      "server_visibility_boost",
      "achievement_participation",
      "seasonal_participation",
      "featured_rotation",
      "enhanced_discovery",
      "profile_customization",
      "enhanced_achievement_tracking",
      "billing_portal",
    ],
    allowed_auto_posts: [...PRO_LISTING_AUTO_POST_TYPES],
    priority_level: 2,
  },
  premium: {
    key: "premium",
    name: "Premium",
    monthly_price: 19.99,
    stripe_price_env_key: "STRIPE_PRICE_PREMIUM",
    server_status_interval_minutes: 1,
    adm_discovery_interval_minutes: 3,
    adm_pull_interval_minutes: 10,
    manual_adm_refresh_cooldown_minutes: 10,
    public_publish_interval_minutes: 0,
    visibility_weight: 4,
    allowed_features: [
      "server_profile",
      "basic_stats",
      "basic_status",
      "leaderboards",
      "advanced_stats",
      "server_vs_server",
      "event_leaderboards",
      "network_rankings",
      "public_network_listing",
      "partner_placement",
      "partner_badge",
      "priority_visibility",
      "priority_refresh",
      "public_featured_listing",
      "achievement_participation",
      "seasonal_participation",
      "featured_rotation",
      "enhanced_discovery",
      "profile_customization",
      "enhanced_achievement_tracking",
      "premium_badge",
      "homepage_featured",
      "priority_discovery",
      "server_spotlight",
      "premium_seasonal_rewards",
      "premium_analytics",
      "premium_reputation_multiplier",
      "billing_portal",
    ],
    allowed_auto_posts: [...PRO_LISTING_AUTO_POST_TYPES],
    priority_level: 4,
  },
};

export const PAID_PLAN_KEYS: PaidPlanKey[] = ["starter", "pro", "premium"];
export const LEGACY_PAID_PLAN_KEYS: LegacyPaidPlanKey[] = ["network", "partner"];
export const AUTO_POST_TYPES: AutoPostType[] = [
  "server_advert",
  "bump_announcement",
  "fresh_wipe",
  "event_announcement",
  "leaderboard_update",
  "longest_kill",
  "rating_review",
  "weekly_recap",
  "milestone",
  "basic_status_embed",
  "leaderboard_embed",
  "daily_summary_embed",
  "event_leaderboard_embed",
  "network_ranking_embed",
  "server_vs_server_embed",
  "killfeed_embed",
  "pve_feed_embed",
  "hit_feed_embed",
  "connection_feed_embed",
  "build_feed_embed",
  "admin_alerts_embed",
  "admin_logs_embed",
  "partner_featured_embed",
  "priority_status_embed",
];

export const AUTO_POST_OPTIONS: AutoPostOption[] = [
  { key: "server_advert", label: "Server Advert", group: "Basic", min_plan_key: "starter", upgrade_label: "Free Listing" },
  { key: "bump_announcement", label: "Bump Announcement", group: "Basic", min_plan_key: "starter", upgrade_label: "Free Listing" },
  { key: "rating_review", label: "Rating & Review", group: "Basic", min_plan_key: "starter", upgrade_label: "Free Listing" },
  { key: "basic_status_embed", label: "Basic Server Status", group: "Basic", min_plan_key: "starter", upgrade_label: "Free Listing" },
  { key: "fresh_wipe", label: "Fresh Wipe", group: "Events", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "event_announcement", label: "Event Announcement", group: "Events", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "leaderboard_update", label: "Leaderboard Update", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "longest_kill", label: "Longest Kill", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "weekly_recap", label: "Weekly Recap", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "milestone", label: "Milestone", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "leaderboard_embed", label: "Legacy Leaderboards", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "daily_summary_embed", label: "Legacy Daily Summary", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "event_leaderboard_embed", label: "Legacy Event Leaderboard", group: "Events", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "server_vs_server_embed", label: "Server-vs-Server Progress", group: "Events", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "network_ranking_embed", label: "Network Ranking", group: "Events", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "killfeed_embed", label: "Killfeed", group: "Feeds", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "pve_feed_embed", label: "PvE Feed", group: "Feeds", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "hit_feed_embed", label: "Hit Feed", group: "Feeds", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "connection_feed_embed", label: "Connection Feed", group: "Feeds", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "build_feed_embed", label: "Build Feed", group: "Feeds", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "admin_alerts_embed", label: "Admin Alerts", group: "Admin", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "admin_logs_embed", label: "Admin Logs", group: "Admin", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "partner_featured_embed", label: "Pro Featured Post", group: "Pro", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
  { key: "priority_status_embed", label: "Priority Status Post", group: "Pro", min_plan_key: "pro", upgrade_label: "Upgrade to Pro" },
];

export function normalizePlanKey(value: unknown): NormalizedPlanKey {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  if (key === "network" || key === "partner") return "premium";
  return key === "starter" || key === "pro" || key === "premium" ? key : "free";
}

export function normalizeListingPlanKey(planOrSubscription: unknown, subscriptionStatus?: unknown): ListingPlanKey {
  const record = isRecord(planOrSubscription) ? planOrSubscription : null;
  const rawPlan = record
    ? record.plan_key ?? record.planKey ?? record.plan ?? record.subscription_plan ?? record.subscriptionPlan
    : planOrSubscription;
  const rawStatus = record
    ? record.subscription_status ?? record.subscriptionStatus ?? record.plan_status ?? record.status
    : subscriptionStatus;
  const normalizedPlan = normalizePlanKey(rawPlan);
  const normalizedStatus = String(rawStatus ?? "").trim().toLowerCase();
  const activePaid = normalizedPlan !== "free" && normalizedPlan !== "starter" && (normalizedStatus === "active" || normalizedStatus === "trialing");
  return activePaid ? "pro" : "free";
}

export function isProListing(planOrSubscription: unknown, subscriptionStatus?: unknown) {
  return normalizeListingPlanKey(planOrSubscription, subscriptionStatus) === "pro";
}

export function getListingLimits(planOrSubscription: unknown, subscriptionStatus?: unknown): ListingLimits {
  return LISTING_LIMITS[normalizeListingPlanKey(planOrSubscription, subscriptionStatus)];
}

export function getBumpCooldownDays(planOrSubscription: unknown, subscriptionStatus?: unknown) {
  return getListingLimits(planOrSubscription, subscriptionStatus).bumpCooldownDays;
}

export function canUseProFeature(planOrSubscription: unknown, featureKey: ListingFeatureKey) {
  if (featureKey === "public_listing" || featureKey === "basic_profile" || featureKey === "ratings_reviews" || featureKey === "discord_basic_embeds") {
    return true;
  }
  return isProListing(planOrSubscription);
}

export function hasListingAutoPost(planOrSubscription: unknown, postType: AutoPostType, subscriptionStatus?: unknown) {
  return getListingLimits(planOrSubscription, subscriptionStatus).allowedAutoPosts.includes(postType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getPlanByKey(planKey: unknown): BillingPlanConfig {
  return BILLING_PLAN_CONFIG[normalizePlanKey(planKey)];
}

export function getPlanByStripePriceId(
  priceId: string | null | undefined,
  priceIds: Partial<Record<PaidPlanKey | LegacyPaidPlanKey, string | null>>,
): NormalizedPlanKey {
  const price = typeof priceId === "string" ? priceId : "";
  if (price && price === priceIds.starter) return "starter";
  if (price && price === priceIds.pro) return "pro";
  if (price && price === priceIds.premium) return "premium";
  if (price && price === priceIds.network) return "premium";
  if (price && price === priceIds.partner) return "premium";
  return "free";
}

export function hasPlanFeature(planKey: unknown, featureKey: PlanFeature) {
  const plan = getPlanByKey(planKey);
  return plan.allowed_features.includes("everything") || plan.allowed_features.includes(featureKey);
}

export function hasAutoPost(planKey: unknown, postType: AutoPostType) {
  return getPlanByKey(planKey).allowed_auto_posts.includes(postType);
}

export function getServerStatusInterval(planKey: unknown) {
  return Math.max(getPlanByKey(planKey).server_status_interval_minutes, MIN_SERVER_STATUS_INTERVAL_MINUTES);
}

export function getAdmPullInterval(planKey: unknown) {
  return Math.max(getPlanByKey(planKey).adm_pull_interval_minutes, MIN_ADM_PULL_INTERVAL_MINUTES);
}

export function getAdmDiscoveryIntervalMinutes(planKey: unknown) {
  return Math.max(getPlanByKey(planKey).adm_discovery_interval_minutes, MIN_ADM_DISCOVERY_INTERVAL_MINUTES);
}

export function getManualRefreshCooldown(planKey: unknown) {
  return Math.max(getPlanByKey(planKey).manual_adm_refresh_cooldown_minutes, MIN_ADM_PULL_INTERVAL_MINUTES);
}

export function getPlanPriority(planKey: unknown) {
  return getPlanByKey(planKey).priority_level;
}

export function getPlanVisibilityWeight(planKey: unknown) {
  return getPlanByKey(planKey).visibility_weight;
}

export function getPublicPublishIntervalMinutes(planKey: unknown) {
  return getPlanByKey(planKey).public_publish_interval_minutes;
}
