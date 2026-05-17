import { requireDb } from "./db";
import type { Env, SessionUser } from "./types";

export type PlanKey = "free" | "starter" | "pro" | "network" | "partner";
export type PaidPlanKey = Exclude<PlanKey, "free">;

export type PlanEntitlements = {
  plan_key: PlanKey;
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
  cancel_at_period_end: boolean;
  entitlements: PlanEntitlements;
  linked_server_count: number;
  can_link_more_servers: boolean;
  stripe_customer_exists: boolean;
  checkout_configured: Record<PaidPlanKey, boolean>;
};

export type BillingPlanSummary = PlanEntitlements & {
  plan_key: PaidPlanKey;
  name: string;
  price_label: string;
  monthly_price_gbp: number;
  configured: boolean;
  features: string[];
};

export const PLAN_CONFIG: Record<PlanKey, PlanEntitlements> = {
  free: {
    plan_key: "free",
    max_linked_servers: 1,
    can_use_reviews: false,
    can_use_public_listing: true,
    can_use_advanced_analytics: false,
    can_join_events: false,
    can_use_ad_bumps: false,
    included_bumps_per_month: 0,
    bump_cooldown_hours: 999,
    can_use_featured_slots: false,
    stat_history_days: 7,
  },
  starter: {
    plan_key: "starter",
    max_linked_servers: 1,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: false,
    can_join_events: false,
    can_use_ad_bumps: false,
    included_bumps_per_month: 0,
    bump_cooldown_hours: 999,
    can_use_featured_slots: false,
    stat_history_days: 30,
  },
  pro: {
    plan_key: "pro",
    max_linked_servers: 3,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: true,
    can_join_events: true,
    can_use_ad_bumps: true,
    included_bumps_per_month: 3,
    bump_cooldown_hours: 24,
    can_use_featured_slots: false,
    stat_history_days: 90,
  },
  network: {
    plan_key: "network",
    max_linked_servers: 10,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: true,
    can_join_events: true,
    can_use_ad_bumps: true,
    included_bumps_per_month: 10,
    bump_cooldown_hours: 12,
    can_use_featured_slots: true,
    stat_history_days: 180,
  },
  partner: {
    plan_key: "partner",
    max_linked_servers: 25,
    can_use_reviews: true,
    can_use_public_listing: true,
    can_use_advanced_analytics: true,
    can_join_events: true,
    can_use_ad_bumps: true,
    included_bumps_per_month: 30,
    bump_cooldown_hours: 6,
    can_use_featured_slots: true,
    stat_history_days: 365,
  },
};

const PAID_PLAN_KEYS: PaidPlanKey[] = ["starter", "pro", "network", "partner"];

const PLAN_MARKETING: Record<PaidPlanKey, {
  name: string;
  price_label: string;
  monthly_price_gbp: number;
  features: string[];
}> = {
  starter: {
    name: "DZN Starter",
    price_label: "£4.99/mo",
    monthly_price_gbp: 4.99,
    features: ["1 linked server", "Full public listing", "Reviews and ratings", "30 day stat history"],
  },
  pro: {
    name: "DZN Pro",
    price_label: "£9.99/mo",
    monthly_price_gbp: 9.99,
    features: ["3 linked servers", "Leaderboard visibility", "Event participation", "3 bumps per month"],
  },
  network: {
    name: "DZN Network",
    price_label: "£19.99/mo",
    monthly_price_gbp: 19.99,
    features: ["10 linked servers", "Multi-server dashboard", "Advanced analytics", "10 bumps per month"],
  },
  partner: {
    name: "DZN Partner",
    price_label: "£29.99/mo",
    monthly_price_gbp: 29.99,
    features: ["25 linked servers", "Featured placement eligibility", "Custom event branding", "30 bumps per month"],
  },
};

export function normalizePlanKey(value: unknown): PlanKey {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  return key === "starter" || key === "pro" || key === "network" || key === "partner" ? key : "free";
}

export function paidPlanKey(value: unknown): PaidPlanKey | null {
  const key = normalizePlanKey(value);
  return key === "free" ? null : key;
}

export function getPlanConfig(planKey: unknown): PlanEntitlements {
  return PLAN_CONFIG[normalizePlanKey(planKey)];
}

export function getPlanFromStripePriceId(env: Env, priceId: string | null | undefined): PlanKey {
  const price = typeof priceId === "string" ? priceId : "";
  if (price && price === getStripePriceIdForPlan(env, "starter")) return "starter";
  if (price && price === getStripePriceIdForPlan(env, "pro")) return "pro";
  if (price && price === getStripePriceIdForPlan(env, "network")) return "network";
  if (price && price === getStripePriceIdForPlan(env, "partner")) return "partner";
  return "free";
}

export function getStripePriceIdForPlan(env: Env, planKey: PlanKey) {
  if (planKey === "starter") return cleanEnvString(env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID);
  if (planKey === "pro") return cleanEnvString(env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID);
  if (planKey === "network") return cleanEnvString(env.NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID);
  if (planKey === "partner") return cleanEnvString(env.NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID);
  return null;
}

export function getCheckoutConfigured(env: Env): Record<PaidPlanKey, boolean> {
  return {
    starter: Boolean(getStripePriceIdForPlan(env, "starter")),
    pro: Boolean(getStripePriceIdForPlan(env, "pro")),
    network: Boolean(getStripePriceIdForPlan(env, "network")),
    partner: Boolean(getStripePriceIdForPlan(env, "partner")),
  };
}

export function getBillingPlanSummaries(env: Env): BillingPlanSummary[] {
  const configured = getCheckoutConfigured(env);
  return PAID_PLAN_KEYS.map((planKey) => ({
    ...PLAN_CONFIG[planKey],
    ...PLAN_MARKETING[planKey],
    plan_key: planKey,
    configured: configured[planKey],
  }));
}

export function effectiveEntitlementPlan(planKey: PlanKey, status: string | null | undefined): PlanKey {
  if (planKey === "free") return "free";
  const normalizedStatus = (status ?? "").toLowerCase();
  return normalizedStatus === "active" || normalizedStatus === "trialing" ? planKey : "free";
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
        updated_at TEXT NOT NULL
      )`,
    )
    .run();

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
        bump_cooldown_hours, can_use_featured_slots, stat_history_days, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const planKey = normalizePlanKey(account?.plan_key);
  const planStatus = typeof account?.plan_status === "string" ? account.plan_status : planKey === "free" ? "free" : "unknown";
  const entitlements = await upsertOwnerEntitlements(env, user.discord_id, planKey, planStatus);
  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM linked_servers
       WHERE user_id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')`,
    )
    .bind(user.id)
    .first<{ count: number }>();
  const linkedServerCount = Number(countRow?.count ?? 0);
  return {
    plan_key: entitlements.plan_key,
    plan_status: planStatus,
    current_period_start: stringOrNull(account?.current_period_start),
    current_period_end: stringOrNull(account?.current_period_end),
    cancel_at_period_end: Number(account?.cancel_at_period_end ?? 0) === 1,
    entitlements,
    linked_server_count: linkedServerCount,
    can_link_more_servers: linkedServerCount < entitlements.max_linked_servers,
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
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.discordUserId,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.planKey,
      input.planStatus,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      boolInt(Boolean(input.cancelAtPeriodEnd)),
      now,
      now,
    )
    .run();
  return upsertOwnerEntitlements(env, input.discordUserId, input.planKey, input.planStatus);
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
  const planKey = normalizePlanKey(row.plan_key);
  return {
    plan_key: planKey,
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
  };
}

function numberOrDefault(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function boolInt(value: boolean) {
  return value ? 1 : 0;
}

function cleanEnvString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
