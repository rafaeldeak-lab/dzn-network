import { requireDb } from "./db";
import type { Env, SessionUser } from "./types";
import {
  AUTO_POST_TYPES,
  AUTO_POST_OPTIONS,
  BILLING_PLAN_CONFIG,
  FREE_BUMP_COOLDOWN_DAYS,
  PAID_PLAN_KEYS,
  PRO_BUMP_COOLDOWN_DAYS,
  canUseProFeature as centralCanUseProFeature,
  getAdmDiscoveryIntervalMinutes as centralAdmDiscoveryInterval,
  getAdmPullInterval as centralAdmPullInterval,
  getBumpCooldownDays as centralGetBumpCooldownDays,
  getListingLimits as centralGetListingLimits,
  getManualRefreshCooldown as centralManualRefreshCooldown,
  getPlanByStripePriceId,
  getPlanPriority as centralPlanPriority,
  getPlanVisibilityWeight as centralPlanVisibilityWeight,
  getPublicPublishIntervalMinutes as centralPublicPublishInterval,
  getServerStatusInterval as centralServerStatusInterval,
  getSubscriptionPlanPublicContract,
  hasAutoPost as centralHasAutoPost,
  hasListingAutoPost as centralHasListingAutoPost,
  hasPlanFeature as centralHasPlanFeature,
  isProListing as centralIsProListing,
  normalizeListingPlanKey as centralNormalizeListingPlanKey,
  normalizePlanKey as centralNormalizePlanKey,
  type AutoPostType,
  type ListingFeatureKey,
  type ListingLimits,
  type ListingPlanKey,
  type NormalizedPlanKey,
  type PlanFeature,
  type PurchasablePlanKey,
  type SubscriptionPlanPublicContract,
} from "../../lib/billing/plans";
import { getLinkedServerAllowanceUsageForUser } from "./onboarding";

export type PaidPlanKey = "starter" | "pro" | "premium";
export type LegacyPaidPlanKey = "network" | "partner";
export type PlanKey = "free" | PaidPlanKey | LegacyPaidPlanKey;

export type PlanEntitlements = {
  plan_key: PlanKey;
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
  max_linked_servers: number;
  can_use_reviews: boolean;
  can_use_public_listing: boolean;
  can_use_advanced_analytics: boolean;
  can_join_events: boolean;
  can_use_ad_bumps: boolean;
  included_bumps_per_month: number;
  bump_cooldown_hours: number;
  can_use_featured_slots: boolean;
  stat_history_days: number;
};

export type BillingStatus = {
  plan_key: PlanKey;
  plan_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  current_period_end_label: string;
  cancel_at_period_end: boolean;
  entitlements: PlanEntitlements;
  linked_server_count: number;
  can_link_more_servers: boolean;
  stripe_customer_exists: boolean;
  checkout_configured: Record<PurchasablePlanKey, boolean>;
};

export type BillingPlanSummary = PlanEntitlements & {
  plan_key: PurchasablePlanKey;
  name: string;
  price_label: string;
  monthly_price_gbp: number;
  public_contract: SubscriptionPlanPublicContract;
  configured: boolean;
  checkout_enabled: boolean;
  checkout_blocked_reason: string | null;
  features: string[];
};

export type CheckoutSafetyMode =
  | "not_configured"
  | "test_mode_allowed"
  | "live_checkout_paused"
  | "live_checkout_enabled"
  | "unknown";

export type CheckoutSafetyStatus = {
  liveCheckoutEnabled: boolean;
  checkoutSessionCreationAllowed: boolean;
  checkoutSafetyMode: CheckoutSafetyMode;
  checkoutBlockedReason: string | null;
};

export type BillingReadinessStatus = {
  starterConfigured: boolean;
  proConfigured: boolean;
  premiumConfigured: boolean;
  stripeSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  liveConfigurationReady: boolean;
  liveCheckoutEnabled: boolean;
  checkoutSessionCreationAllowed: boolean;
  checkoutSafetyMode: CheckoutSafetyMode;
  checkoutBlockedReason: string | null;
  humanApprovalRequiredForLiveBilling: true;
  productionMutationAllowedByReadinessCheck: false;
  priceSources: Record<PurchasablePlanKey, {
    envVar: string;
    publicFallbackEnvVar: string;
    source: "server" | "public_fallback" | "missing";
    configured: boolean;
    liveReady: boolean;
  }>;
  activePlans: Array<{
    plan_key: PurchasablePlanKey;
    name: string;
    price_label: string;
    monthly_price_gbp: number;
    configured: boolean;
    checkout_enabled: boolean;
    checkout_blocked_reason: string | null;
  }>;
  missingRequiredVars: string[];
  missingLiveRequiredVars: string[];
  legacyVarsDetected: string[];
  publicFallbackPriceVarsDetected: string[];
  readinessChecks: Array<{
    key: string;
    label: string;
    ok: boolean;
    severity: "blocker" | "warning" | "info";
    detail: string;
  }>;
  modeHint: "test" | "live" | "unknown" | "not_configured";
};

export type StarterTrialClaim = {
  id: string;
  discord_user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  checkout_session_id: string | null;
  status: string;
  claimed_at: string;
  updated_at: string;
};

export type StarterTrialReservation =
  | { reserved: true; claim: StarterTrialClaim }
  | { reserved: false; claim: StarterTrialClaim | null };

export const PLAN_CONFIG: Record<NormalizedPlanKey, PlanEntitlements> = {
  free: {
    plan_key: "free",
    ...automationPlan("free"),
    max_linked_servers: 1,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: false,
    can_join_events: false,
    can_use_ad_bumps: true,
    included_bumps_per_month: 1,
    bump_cooldown_hours: FREE_BUMP_COOLDOWN_DAYS * 24,
    can_use_featured_slots: false,
    stat_history_days: 7,
  },
  starter: {
    plan_key: "starter",
    ...automationPlan("starter"),
    max_linked_servers: 1,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: false,
    can_join_events: true,
    can_use_ad_bumps: true,
    included_bumps_per_month: 0,
    bump_cooldown_hours: FREE_BUMP_COOLDOWN_DAYS * 24,
    can_use_featured_slots: false,
    stat_history_days: 30,
  },
  pro: {
    plan_key: "pro",
    ...automationPlan("pro"),
    max_linked_servers: 3,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: true,
    can_join_events: true,
    can_use_ad_bumps: true,
    included_bumps_per_month: 2,
    bump_cooldown_hours: PRO_BUMP_COOLDOWN_DAYS * 24,
    can_use_featured_slots: true,
    stat_history_days: 90,
  },
  premium: {
    plan_key: "premium",
    ...automationPlan("premium"),
    max_linked_servers: 3,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: true,
    can_join_events: true,
    can_use_ad_bumps: true,
    included_bumps_per_month: 2,
    bump_cooldown_hours: PRO_BUMP_COOLDOWN_DAYS * 24,
    can_use_featured_slots: true,
    stat_history_days: 90,
  },
};

const PLAN_MARKETING: Record<PurchasablePlanKey, {
  name: string;
  price_label: string;
  monthly_price_gbp: number;
  features: string[];
}> = {
  starter: {
    name: "Starter",
    price_label: "£0 today, then £2/month",
    monthly_price_gbp: 2,
    features: [
      "2-day free trial",
      "Then £2/month",
      "Standard listing",
      "1 linked DayZ server",
      "Public/advert publication every 72h",
      "Earned badges visible",
      "No monthly promotion credits",
      "Cancel before trial expiry to pay nothing",
    ],
  },
  pro: {
    name: "Pro",
    price_label: "£10/month",
    monthly_price_gbp: 10,
    features: [
      "Full DZN Access",
      "Charged immediately",
      "Up to 3 linked DayZ servers",
      "Public/advert publication every 24h",
      "Enhanced discovery and profile tools",
      "Featured and spotlight rotation eligible",
      "2 monthly promotion credits",
      "8 showcase badges",
    ],
  },
};

function canonicalPlanKey(value: unknown): NormalizedPlanKey {
  return centralNormalizePlanKey(value);
}

export function normalizePlanKey(value: unknown): PlanKey {
  return canonicalPlanKey(value);
}

export function paidPlanKey(value: unknown): PurchasablePlanKey | null {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return key === "starter" || key === "pro" ? key : null;
}

export function getPlanConfig(planKey: unknown): PlanEntitlements {
  return PLAN_CONFIG[canonicalPlanKey(planKey)];
}

export function getPlanFromStripePriceId(env: Env, priceId: string | null | undefined): PlanKey {
  return getPlanByStripePriceId(priceId, {
    starter: getStripePriceIdForPlan(env, "starter"),
    pro: getStripePriceIdForPlan(env, "pro"),
    premium: getStripePriceIdForPlan(env, "premium"),
    network: getLegacyStripePriceIdForPlan(env, "network"),
    partner: getLegacyStripePriceIdForPlan(env, "partner"),
  });
}

export function getStripePriceIdForPlan(env: Env, planKey: PlanKey) {
  const normalized = canonicalPlanKey(planKey);
  if (normalized === "starter") return cleanEnvString(env.STRIPE_PRICE_STARTER) ?? cleanEnvString(env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID);
  if (normalized === "pro") return cleanEnvString(env.STRIPE_PRICE_PRO) ?? cleanEnvString(env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID);
  if (normalized === "premium") return cleanEnvString(env.STRIPE_PRICE_PREMIUM) ?? cleanEnvString(env.NEXT_PUBLIC_STRIPE_PREMIUM_PRICE_ID);
  return null;
}

function getLegacyStripePriceIdForPlan(env: Env, planKey: LegacyPaidPlanKey) {
  if (planKey === "network") return cleanEnvString(env.STRIPE_PRICE_NETWORK);
  if (planKey === "partner") return cleanEnvString(env.STRIPE_PRICE_PARTNER);
  return null;
}

export function getCheckoutConfigured(env: Env): Record<PurchasablePlanKey, boolean> {
  return {
    starter: Boolean(getStripePriceIdForPlan(env, "starter")),
    pro: Boolean(getStripePriceIdForPlan(env, "pro")),
  };
}

export function getCheckoutSafetyStatus(env: Env): CheckoutSafetyStatus {
  const configured = getCheckoutConfigured(env);
  const hasConfiguredPrice = configured.starter || configured.pro;
  const modeHint = getStripeModeHint(env);
  const liveCheckoutEnabled = isLiveCheckoutEnabled(env);

  if (!hasConfiguredPrice || modeHint === "not_configured") {
    return {
      liveCheckoutEnabled,
      checkoutSessionCreationAllowed: false,
      checkoutSafetyMode: "not_configured",
      checkoutBlockedReason: "Checkout is not configured yet.",
    };
  }

  if (modeHint === "test") {
    return {
      liveCheckoutEnabled,
      checkoutSessionCreationAllowed: true,
      checkoutSafetyMode: "test_mode_allowed",
      checkoutBlockedReason: null,
    };
  }

  if (modeHint === "live") {
    const livePrerequisitesReady = getLiveCheckoutPrerequisitesReady(env);
    if (liveCheckoutEnabled) {
      if (!livePrerequisitesReady) {
        return {
          liveCheckoutEnabled: true,
          checkoutSessionCreationAllowed: false,
          checkoutSafetyMode: "live_checkout_paused",
          checkoutBlockedReason: "Live checkout enablement was requested, but live readiness prerequisites are still missing.",
        };
      }

      return {
        liveCheckoutEnabled: true,
        checkoutSessionCreationAllowed: true,
        checkoutSafetyMode: "live_checkout_enabled",
        checkoutBlockedReason: null,
      };
    }

    return {
      liveCheckoutEnabled: false,
      checkoutSessionCreationAllowed: false,
      checkoutSafetyMode: "live_checkout_paused",
      checkoutBlockedReason: "Live checkout is paused for sandbox verification. Set DZN_LIVE_CHECKOUT_ENABLED=true only in a later approved go-live step.",
    };
  }

  return {
    liveCheckoutEnabled,
    checkoutSessionCreationAllowed: false,
    checkoutSafetyMode: "unknown",
    checkoutBlockedReason: "Stripe checkout mode is unknown, so checkout is disabled until the key is clearly test mode or explicitly approved live mode.",
  };
}

export function getBillingPlanSummaries(env: Env): BillingPlanSummary[] {
  const configured = getCheckoutConfigured(env);
  const checkoutSafety = getCheckoutSafetyStatus(env);
  return PAID_PLAN_KEYS.map((planKey) => ({
    ...PLAN_CONFIG[planKey],
    ...PLAN_MARKETING[planKey],
    plan_key: planKey,
    public_contract: getSubscriptionPlanPublicContract(planKey)!,
    configured: configured[planKey],
    checkout_enabled: configured[planKey] && checkoutSafety.checkoutSessionCreationAllowed,
    checkout_blocked_reason: configured[planKey] ? checkoutSafety.checkoutBlockedReason : "Plan checkout is not configured yet.",
  }));
}

export function getBillingReadinessStatus(env: Env): BillingReadinessStatus {
  const configured = getCheckoutConfigured(env);
  const priceSources = getBillingPriceSources(env);
  const stripeSecretConfigured = Boolean(cleanEnvString(env.STRIPE_SECRET_KEY));
  const webhookSecretConfigured = Boolean(cleanEnvString(env.STRIPE_WEBHOOK_SECRET));
  const modeHint = getStripeModeHint(env);
  const checkoutSafety = getCheckoutSafetyStatus(env);
  const missingRequiredVars: string[] = [];

  for (const planKey of PAID_PLAN_KEYS) {
    if (!configured[planKey]) {
      missingRequiredVars.push(PLAN_CONFIG[planKey].stripe_price_env_key ?? `STRIPE_PRICE_${planKey.toUpperCase()}`);
    }
  }
  if (!stripeSecretConfigured) missingRequiredVars.push("STRIPE_SECRET_KEY");
  if (!webhookSecretConfigured) missingRequiredVars.push("STRIPE_WEBHOOK_SECRET");

  const missingLiveRequiredVars = getMissingLiveRequiredVars(env, priceSources);
  const readinessChecks = buildBillingReadinessChecks(env, priceSources, modeHint, webhookSecretConfigured, checkoutSafety);
  const liveConfigurationReady = readinessChecks.every((check) => check.severity !== "blocker" || check.ok);

  return {
    starterConfigured: configured.starter,
    proConfigured: configured.pro,
    premiumConfigured: false,
    stripeSecretConfigured,
    webhookSecretConfigured,
    liveConfigurationReady,
    liveCheckoutEnabled: checkoutSafety.liveCheckoutEnabled,
    checkoutSessionCreationAllowed: checkoutSafety.checkoutSessionCreationAllowed,
    checkoutSafetyMode: checkoutSafety.checkoutSafetyMode,
    checkoutBlockedReason: checkoutSafety.checkoutBlockedReason,
    humanApprovalRequiredForLiveBilling: true,
    productionMutationAllowedByReadinessCheck: false,
    priceSources,
    activePlans: getBillingPlanSummaries(env).map((plan) => ({
      plan_key: plan.plan_key,
      name: plan.name,
      price_label: plan.price_label,
      monthly_price_gbp: plan.monthly_price_gbp,
      configured: plan.configured,
      checkout_enabled: plan.checkout_enabled,
      checkout_blocked_reason: plan.checkout_blocked_reason,
    })),
    missingRequiredVars,
    missingLiveRequiredVars,
    legacyVarsDetected: getDetectedLegacyStripeVars(env),
    publicFallbackPriceVarsDetected: getDetectedPublicFallbackPriceVars(env),
    readinessChecks,
    modeHint,
  };
}

export function hasPlanFeature(planKey: unknown, featureKey: PlanFeature) {
  return centralHasPlanFeature(planKey, featureKey);
}

export function hasAutoPost(planKey: unknown, postType: AutoPostType) {
  return centralHasAutoPost(planKey, postType);
}

export function normalizeListingPlanKey(planOrSubscription: unknown, subscriptionStatus?: unknown): ListingPlanKey {
  return centralNormalizeListingPlanKey(planOrSubscription, subscriptionStatus);
}

export function isProListing(planOrSubscription: unknown, subscriptionStatus?: unknown) {
  return centralIsProListing(planOrSubscription, subscriptionStatus);
}

export function getListingLimits(planOrSubscription: unknown, subscriptionStatus?: unknown): ListingLimits {
  return centralGetListingLimits(planOrSubscription, subscriptionStatus);
}

export function getBumpCooldownDays(planOrSubscription: unknown, subscriptionStatus?: unknown) {
  return centralGetBumpCooldownDays(planOrSubscription, subscriptionStatus);
}

export function canUseProFeature(planOrSubscription: unknown, featureKey: ListingFeatureKey) {
  return centralCanUseProFeature(planOrSubscription, featureKey);
}

export function hasListingAutoPost(planOrSubscription: unknown, postType: AutoPostType, subscriptionStatus?: unknown) {
  return centralHasListingAutoPost(planOrSubscription, postType, subscriptionStatus);
}

export function getServerStatusInterval(planKey: unknown) {
  return centralServerStatusInterval(planKey);
}

export function getAdmPullInterval(planKey: unknown) {
  return centralAdmPullInterval(planKey);
}

export function getAdmDiscoveryIntervalMinutes(planKey: unknown) {
  return centralAdmDiscoveryInterval(planKey);
}

export function getManualRefreshCooldown(planKey: unknown) {
  return centralManualRefreshCooldown(planKey);
}

export function getPlanPriority(planKey: unknown) {
  return centralPlanPriority(planKey);
}

export function getPlanVisibilityWeight(planKey: unknown) {
  return centralPlanVisibilityWeight(planKey);
}

export function getPublicPublishIntervalMinutes(planKey: unknown) {
  return centralPublicPublishInterval(planKey);
}

export { AUTO_POST_TYPES };
export { AUTO_POST_OPTIONS };

export function effectiveEntitlementPlan(planKey: PlanKey, status: string | null | undefined): NormalizedPlanKey {
  const normalizedPlanKey = canonicalPlanKey(planKey);
  if (normalizedPlanKey === "free") return "free";
  const normalizedStatus = (status ?? "").toLowerCase();
  return normalizedStatus === "active" || normalizedStatus === "trialing" ? normalizedPlanKey : "free";
}

export async function ensureBillingSchema(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS owner_billing_accounts (
        id TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL UNIQUE,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        plan_key TEXT NOT NULL DEFAULT 'free',
        plan_status TEXT NOT NULL DEFAULT 'free',
        current_period_start TEXT,
        current_period_end TEXT,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_owner_billing_accounts_discord_user_id ON owner_billing_accounts(discord_user_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_owner_billing_accounts_stripe_customer_id ON owner_billing_accounts(stripe_customer_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_owner_billing_accounts_stripe_subscription_id ON owner_billing_accounts(stripe_subscription_id)").run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS owner_plan_entitlements (
        discord_user_id TEXT PRIMARY KEY,
        plan_key TEXT NOT NULL DEFAULT 'free',
        max_linked_servers INTEGER NOT NULL DEFAULT 1,
        can_use_reviews INTEGER NOT NULL DEFAULT 0,
        can_use_public_listing INTEGER NOT NULL DEFAULT 1,
        can_use_advanced_analytics INTEGER NOT NULL DEFAULT 0,
        can_join_events INTEGER NOT NULL DEFAULT 0,
        can_use_ad_bumps INTEGER NOT NULL DEFAULT 0,
        included_bumps_per_month INTEGER NOT NULL DEFAULT 0,
        bump_cooldown_hours INTEGER NOT NULL DEFAULT 24,
        can_use_featured_slots INTEGER NOT NULL DEFAULT 0,
        stat_history_days INTEGER NOT NULL DEFAULT 7,
        public_publish_interval_minutes INTEGER NOT NULL DEFAULT 1440,
        visibility_weight INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();
  await ensureColumn(env, "owner_plan_entitlements", "public_publish_interval_minutes", "INTEGER NOT NULL DEFAULT 1440");
  await ensureColumn(env, "owner_plan_entitlements", "visibility_weight", "INTEGER NOT NULL DEFAULT 0");

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_advertising_state (
        linked_server_id TEXT PRIMARY KEY,
        owner_discord_id TEXT NOT NULL,
        last_bumped_at TEXT,
        bump_count_current_period INTEGER NOT NULL DEFAULT 0,
        bump_period_start TEXT,
        bump_period_end TEXT,
        featured_until TEXT,
        featured_label TEXT,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_advertising_state_owner_discord_id ON server_advertising_state(owner_discord_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_advertising_state_featured_until ON server_advertising_state(featured_until)").run();
  await ensureColumn(env, "server_advertising_state", "next_bump_at", "TEXT");
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_advertising_state_next_bump_at ON server_advertising_state(next_bump_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_advertising_state_last_bumped_at ON server_advertising_state(last_bumped_at)").run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_ad_bump_events (
        id TEXT PRIMARY KEY,
        linked_server_id TEXT NOT NULL,
        owner_discord_id TEXT NOT NULL,
        bump_type TEXT NOT NULL DEFAULT 'included',
        created_at TEXT NOT NULL
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_ad_bump_events_linked_server_id ON server_ad_bump_events(linked_server_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_ad_bump_events_owner_discord_id ON server_ad_bump_events(owner_discord_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_ad_bump_events_created_at ON server_ad_bump_events(created_at)").run();
}

export async function ensureStarterTrialClaimSchema(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS owner_starter_trial_claims (
        id TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        checkout_session_id TEXT,
        status TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    )
    .run();
  await db
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_discord_user_id ON owner_starter_trial_claims(discord_user_id)")
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_stripe_customer_id
       ON owner_starter_trial_claims(stripe_customer_id)
       WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_stripe_subscription_id ON owner_starter_trial_claims(stripe_subscription_id)")
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_owner_starter_trial_claims_checkout_session_id ON owner_starter_trial_claims(checkout_session_id)")
    .run();
}

export async function findStarterTrialClaim(env: Env, input: { discordUserId: string; stripeCustomerId?: string | null }) {
  await ensureStarterTrialClaimSchema(env);
  const stripeCustomerId = cleanOptionalString(input.stripeCustomerId);
  if (stripeCustomerId) {
    return requireDb(env)
      .prepare(
        `SELECT * FROM owner_starter_trial_claims
         WHERE discord_user_id = ? OR stripe_customer_id = ?
         LIMIT 1`,
      )
      .bind(input.discordUserId, stripeCustomerId)
      .first<StarterTrialClaim>();
  }
  return requireDb(env)
    .prepare("SELECT * FROM owner_starter_trial_claims WHERE discord_user_id = ? LIMIT 1")
    .bind(input.discordUserId)
    .first<StarterTrialClaim>();
}

export async function reserveStarterTrialClaim(env: Env, input: { discordUserId: string; stripeCustomerId?: string | null }): Promise<StarterTrialReservation> {
  await ensureStarterTrialClaimSchema(env);
  const existing = await findStarterTrialClaim(env, input);
  if (existing) return { reserved: false, claim: existing };

  const now = new Date().toISOString();
  const stripeCustomerId = cleanOptionalString(input.stripeCustomerId);
  const claim: StarterTrialClaim = {
    id: crypto.randomUUID(),
    discord_user_id: input.discordUserId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: null,
    checkout_session_id: null,
    status: "checkout_created",
    claimed_at: now,
    updated_at: now,
  };
  try {
    await requireDb(env)
      .prepare(
        `INSERT INTO owner_starter_trial_claims (
          id, discord_user_id, stripe_customer_id, stripe_subscription_id, checkout_session_id,
          status, claimed_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, 'checkout_created', ?, ?)`,
      )
      .bind(claim.id, claim.discord_user_id, claim.stripe_customer_id, claim.claimed_at, claim.updated_at)
      .run();
  } catch {
    return { reserved: false, claim: await findStarterTrialClaim(env, input) };
  }

  return { reserved: true, claim };
}

export async function attachStarterTrialCheckoutSession(env: Env, input: {
  discordUserId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  checkoutSessionId?: string | null;
  status?: string | null;
}) {
  await ensureStarterTrialClaimSchema(env);
  await requireDb(env)
    .prepare(
      `UPDATE owner_starter_trial_claims
       SET stripe_customer_id = COALESCE(?, stripe_customer_id),
           stripe_subscription_id = COALESCE(?, stripe_subscription_id),
           checkout_session_id = COALESCE(?, checkout_session_id),
           status = COALESCE(?, status),
           updated_at = ?
       WHERE discord_user_id = ?`,
    )
    .bind(
      cleanOptionalString(input.stripeCustomerId),
      cleanOptionalString(input.stripeSubscriptionId),
      cleanOptionalString(input.checkoutSessionId),
      cleanOptionalString(input.status),
      new Date().toISOString(),
      input.discordUserId,
    )
    .run();
}

export async function releaseStarterTrialReservation(env: Env, input: { discordUserId: string }) {
  await ensureStarterTrialClaimSchema(env);
  await requireDb(env)
    .prepare(
      `DELETE FROM owner_starter_trial_claims
       WHERE discord_user_id = ?
         AND status = 'checkout_created'
         AND checkout_session_id IS NULL
         AND stripe_subscription_id IS NULL`,
    )
    .bind(input.discordUserId)
    .run();
}

export async function upsertStarterTrialClaimFromStripe(env: Env, input: {
  discordUserId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  checkoutSessionId?: string | null;
  status: string;
}) {
  await ensureStarterTrialClaimSchema(env);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO owner_starter_trial_claims (
        id, discord_user_id, stripe_customer_id, stripe_subscription_id, checkout_session_id,
        status, claimed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_user_id) DO UPDATE SET
        stripe_customer_id = COALESCE(excluded.stripe_customer_id, owner_starter_trial_claims.stripe_customer_id),
        stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, owner_starter_trial_claims.stripe_subscription_id),
        checkout_session_id = COALESCE(excluded.checkout_session_id, owner_starter_trial_claims.checkout_session_id),
        status = excluded.status,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.discordUserId,
      cleanOptionalString(input.stripeCustomerId),
      cleanOptionalString(input.stripeSubscriptionId),
      cleanOptionalString(input.checkoutSessionId),
      cleanOptionalString(input.status) ?? "unknown",
      now,
      now,
    )
    .run();
}

export async function upsertOwnerEntitlements(env: Env, discordUserId: string, planKey: PlanKey, status: string) {
  await ensureBillingSchema(env);
  const effectivePlan = effectiveEntitlementPlan(planKey, status);
  const config = getPlanConfig(effectivePlan);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO owner_plan_entitlements (
        discord_user_id, plan_key, max_linked_servers, can_use_reviews, can_use_public_listing,
        can_use_advanced_analytics, can_join_events, can_use_ad_bumps, included_bumps_per_month,
        bump_cooldown_hours, can_use_featured_slots, stat_history_days, public_publish_interval_minutes,
        visibility_weight, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_user_id) DO UPDATE SET
        plan_key = excluded.plan_key,
        max_linked_servers = excluded.max_linked_servers,
        can_use_reviews = excluded.can_use_reviews,
        can_use_public_listing = excluded.can_use_public_listing,
        can_use_advanced_analytics = excluded.can_use_advanced_analytics,
        can_join_events = excluded.can_join_events,
        can_use_ad_bumps = excluded.can_use_ad_bumps,
        included_bumps_per_month = excluded.included_bumps_per_month,
        bump_cooldown_hours = excluded.bump_cooldown_hours,
        can_use_featured_slots = excluded.can_use_featured_slots,
        stat_history_days = excluded.stat_history_days,
        public_publish_interval_minutes = excluded.public_publish_interval_minutes,
        visibility_weight = excluded.visibility_weight,
        updated_at = excluded.updated_at`,
    )
    .bind(
      discordUserId,
      config.plan_key,
      config.max_linked_servers,
      boolInt(config.can_use_reviews),
      boolInt(config.can_use_public_listing),
      boolInt(config.can_use_advanced_analytics),
      boolInt(config.can_join_events),
      boolInt(config.can_use_ad_bumps),
      config.included_bumps_per_month,
      config.bump_cooldown_hours,
      boolInt(config.can_use_featured_slots),
      config.stat_history_days,
      config.public_publish_interval_minutes,
      config.visibility_weight,
      now,
    )
    .run();
  return config;
}

export async function getOwnerEntitlements(env: Env, discordUserId: string): Promise<PlanEntitlements> {
  await ensureBillingSchema(env);
  const row = await requireDb(env)
    .prepare("SELECT * FROM owner_plan_entitlements WHERE discord_user_id = ? LIMIT 1")
    .bind(discordUserId)
    .first<Record<string, unknown>>();
  if (!row) return upsertOwnerEntitlements(env, discordUserId, "free", "free");
  return entitlementsFromRow(row);
}

export async function getOwnerBillingStatus(env: Env, user: SessionUser): Promise<BillingStatus> {
  await ensureBillingSchema(env);
  const db = requireDb(env);
  const account = await db
    .prepare("SELECT * FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
    .bind(user.discord_id)
    .first<Record<string, unknown>>();
  const planKey = canonicalPlanKey(account?.plan_key);
  const planStatus = typeof account?.plan_status === "string" ? account.plan_status : planKey === "free" ? "free" : "unknown";
  const entitlements = await upsertOwnerEntitlements(env, user.discord_id, planKey, planStatus);
  const allowanceUsage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: user.id,
    discordUserId: user.discord_id,
    limit: entitlements.max_linked_servers,
  });
  return {
    plan_key: entitlements.plan_key,
    plan_status: planStatus,
    current_period_start: stringOrNull(account?.current_period_start),
    current_period_end: stringOrNull(account?.current_period_end),
    current_period_end_label: formatBillingPeriodEndLabel(account?.current_period_end),
    cancel_at_period_end: Number(account?.cancel_at_period_end ?? 0) === 1,
    entitlements,
    linked_server_count: allowanceUsage.used,
    can_link_more_servers: allowanceUsage.canLinkMore,
    stripe_customer_exists: Boolean(account?.stripe_customer_id),
    checkout_configured: getCheckoutConfigured(env),
  };
}

export async function upsertBillingAccount(env: Env, input: {
  discordUserId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planKey: PlanKey;
  planStatus: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}) {
  await ensureBillingSchema(env);
  const now = new Date().toISOString();
  const normalizedPlanKey = canonicalPlanKey(input.planKey);
  await requireDb(env)
    .prepare(
      `INSERT INTO owner_billing_accounts (
        id, discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_status,
        current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_user_id) DO UPDATE SET
        stripe_customer_id = COALESCE(excluded.stripe_customer_id, owner_billing_accounts.stripe_customer_id),
        stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, owner_billing_accounts.stripe_subscription_id),
        plan_key = excluded.plan_key,
        plan_status = excluded.plan_status,
        current_period_start = COALESCE(excluded.current_period_start, owner_billing_accounts.current_period_start),
        current_period_end = COALESCE(excluded.current_period_end, owner_billing_accounts.current_period_end),
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.discordUserId,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      normalizedPlanKey,
      input.planStatus,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      boolInt(Boolean(input.cancelAtPeriodEnd)),
      now,
      now,
    )
    .run();
  return upsertOwnerEntitlements(env, input.discordUserId, normalizedPlanKey, input.planStatus);
}

export async function findBillingAccountByCustomerOrSubscription(env: Env, input: { customerId?: string | null; subscriptionId?: string | null }) {
  await ensureBillingSchema(env);
  if (!input.customerId && !input.subscriptionId) return null;
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (input.customerId) {
    clauses.push("stripe_customer_id = ?");
    bindings.push(input.customerId);
  }
  if (input.subscriptionId) {
    clauses.push("stripe_subscription_id = ?");
    bindings.push(input.subscriptionId);
  }
  return requireDb(env)
    .prepare(`SELECT * FROM owner_billing_accounts WHERE ${clauses.join(" OR ")} LIMIT 1`)
    .bind(...bindings)
    .first<Record<string, unknown>>();
}

export function entitlementsFromRow(row: Record<string, unknown>): PlanEntitlements {
  const planKey = canonicalPlanKey(row.plan_key);
  return {
    plan_key: planKey,
    ...automationPlan(planKey),
    max_linked_servers: numberOrDefault(row.max_linked_servers, PLAN_CONFIG[planKey].max_linked_servers),
    can_use_reviews: Number(row.can_use_reviews ?? 0) === 1,
    can_use_public_listing: Number(row.can_use_public_listing ?? 1) === 1,
    can_use_advanced_analytics: Number(row.can_use_advanced_analytics ?? 0) === 1,
    can_join_events: Number(row.can_join_events ?? 0) === 1,
    can_use_ad_bumps: Number(row.can_use_ad_bumps ?? 0) === 1,
    included_bumps_per_month: numberOrDefault(row.included_bumps_per_month, 0),
    bump_cooldown_hours: numberOrDefault(row.bump_cooldown_hours, 24),
    can_use_featured_slots: Number(row.can_use_featured_slots ?? 0) === 1,
    stat_history_days: numberOrDefault(row.stat_history_days, 7),
    public_publish_interval_minutes: numberOrDefault(row.public_publish_interval_minutes, PLAN_CONFIG[planKey].public_publish_interval_minutes),
    visibility_weight: numberOrDefault(row.visibility_weight, PLAN_CONFIG[planKey].visibility_weight),
  };
}

function automationPlan(planKey: PlanKey) {
  const plan = BILLING_PLAN_CONFIG[canonicalPlanKey(planKey)];
  return {
    name: plan.name,
    monthly_price: plan.monthly_price,
    stripe_price_env_key: plan.stripe_price_env_key,
    server_status_interval_minutes: plan.server_status_interval_minutes,
    adm_discovery_interval_minutes: plan.adm_discovery_interval_minutes,
    adm_pull_interval_minutes: plan.adm_pull_interval_minutes,
    manual_adm_refresh_cooldown_minutes: plan.manual_adm_refresh_cooldown_minutes,
    public_publish_interval_minutes: plan.public_publish_interval_minutes,
    visibility_weight: plan.visibility_weight,
    allowed_features: plan.allowed_features,
    allowed_auto_posts: plan.allowed_auto_posts,
    priority_level: plan.priority_level,
  };
}

async function ensureColumn(env: Env, tableName: string, columnName: string, definition: string) {
  const db = requireDb(env);
  const columns = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  const exists = (columns.results ?? []).some((column) => column.name === columnName);
  if (!exists) {
    await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function numberOrDefault(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolInt(value: boolean) {
  return value ? 1 : 0;
}

function getDetectedLegacyStripeVars(env: Env) {
  const legacyVars: string[] = [];
  if (cleanEnvString(env.STRIPE_PRICE_PREMIUM)) legacyVars.push("STRIPE_PRICE_PREMIUM");
  if (cleanEnvString(env.STRIPE_PRICE_NETWORK)) legacyVars.push("STRIPE_PRICE_NETWORK");
  if (cleanEnvString(env.STRIPE_PRICE_PARTNER)) legacyVars.push("STRIPE_PRICE_PARTNER");
  return legacyVars;
}

function getBillingPriceSources(env: Env): BillingReadinessStatus["priceSources"] {
  return {
    starter: getBillingPriceSource(env, "STRIPE_PRICE_STARTER", "NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID"),
    pro: getBillingPriceSource(env, "STRIPE_PRICE_PRO", "NEXT_PUBLIC_STRIPE_PRO_PRICE_ID"),
  };
}

function getBillingPriceSource(
  env: Env,
  envVar: "STRIPE_PRICE_STARTER" | "STRIPE_PRICE_PRO",
  publicFallbackEnvVar: "NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID" | "NEXT_PUBLIC_STRIPE_PRO_PRICE_ID",
): BillingReadinessStatus["priceSources"][PurchasablePlanKey] {
  const serverValue = cleanEnvString(env[envVar]);
  const publicFallbackValue = cleanEnvString(env[publicFallbackEnvVar]);
  if (serverValue) {
    return { envVar, publicFallbackEnvVar, source: "server", configured: true, liveReady: true };
  }
  if (publicFallbackValue) {
    return { envVar, publicFallbackEnvVar, source: "public_fallback", configured: true, liveReady: false };
  }
  return { envVar, publicFallbackEnvVar, source: "missing", configured: false, liveReady: false };
}

function getDetectedPublicFallbackPriceVars(env: Env) {
  const vars: string[] = [];
  if (cleanEnvString(env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID)) vars.push("NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID");
  if (cleanEnvString(env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID)) vars.push("NEXT_PUBLIC_STRIPE_PRO_PRICE_ID");
  if (cleanEnvString(env.NEXT_PUBLIC_STRIPE_PREMIUM_PRICE_ID)) vars.push("NEXT_PUBLIC_STRIPE_PREMIUM_PRICE_ID");
  return vars;
}

function getMissingLiveRequiredVars(env: Env, priceSources: BillingReadinessStatus["priceSources"]) {
  const missing = new Set<string>();
  for (const planKey of PAID_PLAN_KEYS) {
    const source = priceSources[planKey];
    if (!source.liveReady) missing.add(source.envVar);
  }
  if (getStripeModeHint(env) !== "live") missing.add("STRIPE_SECRET_KEY");
  if (!cleanEnvString(env.STRIPE_WEBHOOK_SECRET)) missing.add("STRIPE_WEBHOOK_SECRET");
  if (!hasProductionAppUrl(env)) missing.add("DZN_APP_URL");
  return [...missing];
}

function buildBillingReadinessChecks(
  env: Env,
  priceSources: BillingReadinessStatus["priceSources"],
  modeHint: BillingReadinessStatus["modeHint"],
  webhookSecretConfigured: boolean,
  checkoutSafety: CheckoutSafetyStatus,
): BillingReadinessStatus["readinessChecks"] {
  const publicFallbackVars = getDetectedPublicFallbackPriceVars(env);
  return [
    {
      key: "starter-server-price",
      label: "Starter live price",
      ok: priceSources.starter.source === "server",
      severity: "blocker",
      detail: "Live billing requires STRIPE_PRICE_STARTER as a server-side Cloudflare Pages variable. Public fallback aliases are not enough for live readiness.",
    },
    {
      key: "pro-server-price",
      label: "Pro live price",
      ok: priceSources.pro.source === "server",
      severity: "blocker",
      detail: "Live billing requires STRIPE_PRICE_PRO as a server-side Cloudflare Pages variable. Public fallback aliases are not enough for live readiness.",
    },
    {
      key: "stripe-live-secret",
      label: "Live Stripe secret",
      ok: modeHint === "live",
      severity: "blocker",
      detail: "Live billing requires a live-mode STRIPE_SECRET_KEY. Test keys can validate checkout flow but must not be used for real payments.",
    },
    {
      key: "stripe-webhook-secret",
      label: "Webhook signing secret",
      ok: webhookSecretConfigured,
      severity: "blocker",
      detail: "Live billing requires STRIPE_WEBHOOK_SECRET from the live production webhook endpoint.",
    },
    {
      key: "production-app-url",
      label: "Production app URL",
      ok: hasProductionAppUrl(env),
      severity: "blocker",
      detail: "Live checkout redirects must use the production DZN URL, not a preview deployment.",
    },
    {
      key: "public-price-fallbacks",
      label: "Public price alias cleanup",
      ok: publicFallbackVars.length === 0,
      severity: "warning",
      detail: "NEXT_PUBLIC_STRIPE_* price aliases are compatibility fallbacks only. They should not be the evidence used for live billing readiness.",
    },
    {
      key: "live-checkout-enable-flag",
      label: "Live checkout enable flag",
      ok: modeHint !== "live" || checkoutSafety.liveCheckoutEnabled,
      severity: "info",
      detail: checkoutSafety.checkoutSafetyMode === "live_checkout_paused"
        ? "Live checkout is intentionally paused until DZN_LIVE_CHECKOUT_ENABLED=true is set during a separate controlled go-live approval. Test-mode checkout can still be used for sandbox validation."
        : "DZN_LIVE_CHECKOUT_ENABLED only controls whether live customer checkout may start; it does not create Stripe products, set secrets, apply migrations, or approve billing by itself.",
    },
    {
      key: "human-approved-live-step",
      label: "Human-approved live billing step",
      ok: false,
      severity: "info",
      detail: "This readiness report is read-only. Creating or changing live Stripe products, prices, webhooks, secrets, D1 data, or migrations remains a separate high-risk human-approved operation.",
    },
  ];
}

function getStripeModeHint(env: Env): BillingReadinessStatus["modeHint"] {
  const secret = cleanEnvString(env.STRIPE_SECRET_KEY);
  if (!secret) return "not_configured";
  if (secret.startsWith("sk_live_")) return "live";
  if (secret.startsWith("sk_test_")) return "test";
  return "unknown";
}

function isLiveCheckoutEnabled(env: Env) {
  const value = cleanEnvString(env.DZN_LIVE_CHECKOUT_ENABLED);
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getLiveCheckoutPrerequisitesReady(env: Env) {
  const priceSources = getBillingPriceSources(env);
  return PAID_PLAN_KEYS.every((planKey) => priceSources[planKey].liveReady)
    && Boolean(cleanEnvString(env.STRIPE_WEBHOOK_SECRET))
    && hasProductionAppUrl(env);
}

function hasProductionAppUrl(env: Env) {
  const value = cleanEnvString(env.DZN_APP_URL) ?? cleanEnvString(env.NEXT_PUBLIC_APP_URL);
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hostname.endsWith(".pages.dev") && url.hostname !== "dzn-network.pages.dev") return false;
    return url.hostname === "dzn-network.pages.dev" || url.hostname === "dayz-network.com" || url.hostname.endsWith(".dayz-network.com");
  } catch {
    return false;
  }
}

function cleanEnvString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatBillingPeriodEndLabel(value: unknown) {
  const dateValue = stringOrNull(value);
  if (!dateValue) return "Awaiting Stripe update";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Awaiting Stripe update";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
