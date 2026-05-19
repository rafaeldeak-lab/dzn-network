export type PlanKey = "free" | "starter" | "pro" | "network" | "partner";
export type PaidPlanKey = Exclude<PlanKey, "free">;

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
  | "billing_portal"
  | "everything";

export type AutoPostType =
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
  key: PlanKey;
  name: string;
  monthly_price: number;
  stripe_price_env_key: string | null;
  server_status_interval_minutes: number;
  adm_discovery_interval_minutes: number;
  adm_pull_interval_minutes: number;
  manual_adm_refresh_cooldown_minutes: number;
  allowed_features: PlanFeature[];
  allowed_auto_posts: AutoPostType[];
  priority_level: number;
};

export type AutoPostOptionGroup = "Basic" | "Stats" | "Events" | "Feeds" | "Admin" | "Partner";
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

export const BILLING_PLAN_CONFIG: Record<PlanKey, BillingPlanConfig> = {
  free: {
    key: "free",
    name: "DZN Free",
    monthly_price: 0,
    stripe_price_env_key: null,
    server_status_interval_minutes: 60,
    adm_discovery_interval_minutes: 60,
    adm_pull_interval_minutes: 1440,
    manual_adm_refresh_cooldown_minutes: 1440,
    allowed_features: ["server_profile", "basic_status"],
    allowed_auto_posts: [],
    priority_level: 0,
  },
  starter: {
    key: "starter",
    name: "DZN Starter",
    monthly_price: 4.99,
    stripe_price_env_key: "STRIPE_PRICE_STARTER",
    server_status_interval_minutes: 7,
    adm_discovery_interval_minutes: 15,
    adm_pull_interval_minutes: 60,
    manual_adm_refresh_cooldown_minutes: 60,
    allowed_features: ["server_profile", "basic_stats", "basic_status", "billing_portal"],
    allowed_auto_posts: ["basic_status_embed"],
    priority_level: 1,
  },
  pro: {
    key: "pro",
    name: "DZN Pro",
    monthly_price: 9.99,
    stripe_price_env_key: "STRIPE_PRICE_PRO",
    server_status_interval_minutes: 5,
    adm_discovery_interval_minutes: 10,
    adm_pull_interval_minutes: 30,
    manual_adm_refresh_cooldown_minutes: 30,
    allowed_features: [
      "server_profile",
      "basic_stats",
      "basic_status",
      "leaderboards",
      "advanced_stats",
      "server_visibility_boost",
      "billing_portal",
    ],
    allowed_auto_posts: ["basic_status_embed", "leaderboard_embed", "daily_summary_embed"],
    priority_level: 2,
  },
  network: {
    key: "network",
    name: "DZN Network",
    monthly_price: 19.99,
    stripe_price_env_key: "STRIPE_PRICE_NETWORK",
    server_status_interval_minutes: 3,
    adm_discovery_interval_minutes: 5,
    adm_pull_interval_minutes: 15,
    manual_adm_refresh_cooldown_minutes: 15,
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
      "billing_portal",
    ],
    allowed_auto_posts: [
      "basic_status_embed",
      "leaderboard_embed",
      "daily_summary_embed",
      "event_leaderboard_embed",
      "network_ranking_embed",
      "server_vs_server_embed",
    ],
    priority_level: 3,
  },
  partner: {
    key: "partner",
    name: "DZN Partner",
    monthly_price: 29.99,
    stripe_price_env_key: "STRIPE_PRICE_PARTNER",
    server_status_interval_minutes: 1,
    adm_discovery_interval_minutes: 3,
    adm_pull_interval_minutes: 10,
    manual_adm_refresh_cooldown_minutes: 10,
    allowed_features: [
      "everything",
      "partner_placement",
      "partner_badge",
      "priority_visibility",
      "priority_refresh",
      "public_featured_listing",
      "billing_portal",
    ],
    allowed_auto_posts: [
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
    ],
    priority_level: 4,
  },
};

export const PAID_PLAN_KEYS: PaidPlanKey[] = ["starter", "pro", "network", "partner"];
export const AUTO_POST_TYPES: AutoPostType[] = [
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
  { key: "basic_status_embed", label: "Basic Server Status", group: "Basic", min_plan_key: "starter", upgrade_label: "Upgrade to DZN Starter" },
  { key: "leaderboard_embed", label: "Leaderboards", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to DZN Pro" },
  { key: "daily_summary_embed", label: "Daily Summary", group: "Stats", min_plan_key: "pro", upgrade_label: "Upgrade to DZN Pro" },
  { key: "event_leaderboard_embed", label: "Event Leaderboard", group: "Events", min_plan_key: "network", upgrade_label: "Upgrade to DZN Network" },
  { key: "server_vs_server_embed", label: "Server-vs-Server Progress", group: "Events", min_plan_key: "network", upgrade_label: "Upgrade to DZN Network" },
  { key: "network_ranking_embed", label: "Network Ranking", group: "Events", min_plan_key: "network", upgrade_label: "Upgrade to DZN Network" },
  { key: "killfeed_embed", label: "Killfeed", group: "Feeds", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "pve_feed_embed", label: "PvE Feed", group: "Feeds", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "hit_feed_embed", label: "Hit Feed", group: "Feeds", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "connection_feed_embed", label: "Connection Feed", group: "Feeds", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "build_feed_embed", label: "Build Feed", group: "Feeds", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "admin_alerts_embed", label: "Admin Alerts", group: "Admin", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "admin_logs_embed", label: "Admin Logs", group: "Admin", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "partner_featured_embed", label: "Partner Featured Post", group: "Partner", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
  { key: "priority_status_embed", label: "Priority Status Post", group: "Partner", min_plan_key: "partner", upgrade_label: "Upgrade to DZN Partner" },
];

export function normalizePlanKey(value: unknown): PlanKey {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return key === "starter" || key === "pro" || key === "network" || key === "partner" ? key : "free";
}

export function getPlanByKey(planKey: unknown): BillingPlanConfig {
  return BILLING_PLAN_CONFIG[normalizePlanKey(planKey)];
}

export function getPlanByStripePriceId(
  priceId: string | null | undefined,
  priceIds: Partial<Record<PaidPlanKey, string | null>>,
): PlanKey {
  const price = typeof priceId === "string" ? priceId : "";
  if (price && price === priceIds.starter) return "starter";
  if (price && price === priceIds.pro) return "pro";
  if (price && price === priceIds.network) return "network";
  if (price && price === priceIds.partner) return "partner";
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
