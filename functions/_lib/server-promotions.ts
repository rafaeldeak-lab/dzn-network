import { normalizePlanKey } from "../../lib/billing/plans";
import { requireDb } from "./db";
import type { Env } from "./types";

export type PromotionType = "directory_bump" | "featured_rotation" | "spotlight_boost" | "seasonal_push";

export type PromotionRow = {
  id: string;
  server_id: string;
  promotion_type: PromotionType;
  status: "active" | "expired" | "cancelled";
  starts_at: string;
  ends_at: string;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
};

export type PromotionCreditsRow = {
  id: string;
  server_id: string;
  plan_key: string;
  credits_available: number;
  credits_used: number;
  period_start: string;
  period_end: string;
  created_at: string;
  updated_at: string;
};

export type PromotionAnalyticsEvent = {
  id: string;
  type: "impression" | "click";
  source: string;
  promotionId: string | null;
  occurredAt: string;
};

export type PromotionTypeStatus = {
  promotionType: PromotionType;
  label: string;
  allowed: boolean;
  reason: string | null;
  durationHours: number;
};

export type PromotionConfig = {
  planKey: "starter" | "pro" | "premium";
  monthlyCredits: number;
  allowedPromotionTypes: PromotionType[];
  lockedPromotionTypes: PromotionTypeStatus[];
  availablePromotionTypes: PromotionTypeStatus[];
  durationsHours: Record<PromotionType, number>;
};

type PromotionServerRow = {
  id: string;
  plan_key: string | null;
  subscription_status: string | null;
};

type PromotionAnalyticsCountRow = {
  total: number | null;
};

type PromotionAnalyticsEventRow = {
  id: string;
  type: "impression" | "click";
  source: string;
  promotion_id: string | null;
  occurred_at: string;
};

export class PromotionError extends Error {
  status: number;
  errorCode: string;

  constructor(errorCode: string, message: string, status = 400) {
    super(message);
    this.name = "PromotionError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

const PROMOTION_TYPES: PromotionType[] = ["directory_bump", "featured_rotation", "spotlight_boost", "seasonal_push"];
const ACTIVE_PROMOTION_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const DURATION_HOURS: Record<PromotionType, number> = {
  directory_bump: 24,
  featured_rotation: 48,
  spotlight_boost: 72,
  seasonal_push: 0,
};

export function getPromotionConfigForPlan(planKey: unknown): PromotionConfig {
  const normalized = promotionPlanKey(planKey);
  const monthlyCredits = normalized === "premium" ? 8 : normalized === "pro" ? 2 : 0;
  const allowedPromotionTypes: PromotionType[] = normalized === "premium"
    ? ["directory_bump", "featured_rotation", "spotlight_boost"]
    : normalized === "pro"
      ? ["directory_bump", "featured_rotation"]
      : [];
  const availablePromotionTypes = allowedPromotionTypes.map((promotionType) => typeStatus(promotionType, true, null));
  const lockedPromotionTypes = PROMOTION_TYPES
    .filter((promotionType) => !allowedPromotionTypes.includes(promotionType))
    .map((promotionType) => typeStatus(promotionType, false, lockedReason(normalized, promotionType)));

  return {
    planKey: normalized,
    monthlyCredits,
    allowedPromotionTypes,
    availablePromotionTypes,
    lockedPromotionTypes,
    durationsHours: DURATION_HOURS,
  };
}

export function hasActivePromotionSubscription(status: unknown) {
  return typeof status === "string" && ACTIVE_PROMOTION_SUBSCRIPTION_STATUSES.has(status.trim().toLowerCase());
}

export function getPromotionConfigForSubscription(planKey: unknown, subscriptionStatus: unknown): PromotionConfig {
  return getPromotionConfigForPlan(hasActivePromotionSubscription(subscriptionStatus) ? planKey : "starter");
}

export async function getServerPromotionCredits(env: Env, serverId: string) {
  return ensurePromotionCreditsForCurrentPeriod(env, serverId);
}

export async function ensurePromotionCreditsForCurrentPeriod(env: Env, serverId: string): Promise<PromotionCreditsRow> {
  await ensurePromotionSchema(env);
  const server = await findPromotionServer(env, serverId);
  if (!server) throw new PromotionError("SERVER_NOT_FOUND", "Server not found.", 404);

  const now = new Date();
  const period = currentPeriod(now);
  const config = getPromotionConfigForSubscription(server.plan_key, server.subscription_status);
  const db = requireDb(env);
  const existing = await db
    .prepare("SELECT * FROM promotion_credits WHERE server_id = ? AND period_start = ? LIMIT 1")
    .bind(server.id, period.start)
    .first<PromotionCreditsRow>();

  if (!existing) {
    const row: PromotionCreditsRow = {
      id: crypto.randomUUID(),
      server_id: server.id,
      plan_key: config.planKey,
      credits_available: config.monthlyCredits,
      credits_used: 0,
      period_start: period.start,
      period_end: period.end,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    await db
      .prepare(
        `INSERT INTO promotion_credits (
          id, server_id, plan_key, credits_available, credits_used, period_start, period_end, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, row.server_id, row.plan_key, row.credits_available, row.credits_used, row.period_start, row.period_end, row.created_at, row.updated_at)
      .run();
    return row;
  }

  const used = Math.max(0, Number(existing.credits_used ?? 0));
  const expectedAvailable = Math.max(0, config.monthlyCredits - used);
  if (existing.plan_key !== config.planKey || Number(existing.credits_available ?? 0) !== expectedAvailable || existing.period_end !== period.end) {
    const updatedAt = now.toISOString();
    await db
      .prepare("UPDATE promotion_credits SET plan_key = ?, credits_available = ?, period_end = ?, updated_at = ? WHERE id = ?")
      .bind(config.planKey, expectedAvailable, period.end, updatedAt, existing.id)
      .run();
    return {
      ...existing,
      plan_key: config.planKey,
      credits_available: expectedAvailable,
      period_end: period.end,
      updated_at: updatedAt,
    };
  }

  return existing;
}

export async function usePromotionCredit(env: Env, serverId: string, promotionType: unknown, actorUserId: string | null) {
  await ensurePromotionSchema(env);
  const type = normalizePromotionType(promotionType);
  if (!type) throw new PromotionError("PROMOTION_TYPE_INVALID", "Choose a valid promotion type.", 400);
  if (type === "seasonal_push") throw new PromotionError("PROMOTION_TYPE_LOCKED", "Seasonal push is reserved for future seasonal campaigns.", 403);

  const credits = await ensurePromotionCreditsForCurrentPeriod(env, serverId);
  const config = getPromotionConfigForPlan(credits.plan_key);
  if (!config.allowedPromotionTypes.includes(type)) {
    throw new PromotionError("PROMOTION_TYPE_LOCKED", promotionLockedMessage(config.planKey, type), 403);
  }
  if (Number(credits.credits_available ?? 0) <= 0) {
    throw new PromotionError("PROMOTION_CREDITS_EMPTY", "No promotion credits are available for this period.", 402);
  }

  const duplicate = await findActivePromotion(env, serverId, type);
  if (duplicate) {
    throw new PromotionError("PROMOTION_ALREADY_ACTIVE", "That promotion is already active for this server.", 409);
  }

  const now = new Date();
  const startsAt = now.toISOString();
  const endsAt = new Date(now.getTime() + config.durationsHours[type] * 60 * 60 * 1000).toISOString();
  const db = requireDb(env);
  const update = await db
    .prepare(
      `UPDATE promotion_credits
       SET credits_available = credits_available - 1,
           credits_used = credits_used + 1,
           updated_at = ?
       WHERE id = ?
         AND credits_available > 0`,
    )
    .bind(startsAt, credits.id)
    .run();
  if (Number(update.meta?.changes ?? 0) !== 1) {
    throw new PromotionError("PROMOTION_CREDITS_EMPTY", "No promotion credits are available for this period.", 402);
  }

  const promotion: PromotionRow = {
    id: crypto.randomUUID(),
    server_id: serverId,
    promotion_type: type,
    status: "active",
    starts_at: startsAt,
    ends_at: endsAt,
    created_at: startsAt,
    updated_at: startsAt,
    metadata_json: JSON.stringify({ planKey: config.planKey, source: "promotion_credit" }),
  };
  await db
    .prepare(
      `INSERT INTO server_promotions (
        id, server_id, promotion_type, status, starts_at, ends_at, created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      promotion.id,
      promotion.server_id,
      promotion.promotion_type,
      promotion.status,
      promotion.starts_at,
      promotion.ends_at,
      promotion.created_at,
      promotion.updated_at,
      promotion.metadata_json,
    )
    .run();

  await logPromotionAudit(env, {
    serverId,
    actorUserId,
    action: "promotion_credit_used",
    oldValue: { creditsAvailable: credits.credits_available, creditsUsed: credits.credits_used },
    newValue: {
      promotionType: type,
      promotionId: promotion.id,
      creditsAvailable: Math.max(0, Number(credits.credits_available ?? 0) - 1),
      creditsUsed: Number(credits.credits_used ?? 0) + 1,
      startsAt,
      endsAt,
    },
  });

  return getPromotionStatus(env, serverId);
}

export async function getActivePromotionsForServer(env: Env, serverId: string): Promise<PromotionRow[]> {
  await ensurePromotionSchema(env);
  const now = new Date().toISOString();
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM server_promotions
       WHERE server_id = ?
         AND status = 'active'
         AND ends_at > ?
       ORDER BY ends_at DESC`,
    )
    .bind(serverId, now)
    .all<PromotionRow>();
  return rows.results ?? [];
}

export async function getPromotionStatus(env: Env, serverId: string) {
  const credits = await ensurePromotionCreditsForCurrentPeriod(env, serverId);
  const config = getPromotionConfigForPlan(credits.plan_key);
  const activePromotions = await getActivePromotionsForServer(env, serverId);
  return {
    planKey: config.planKey,
    creditsAvailable: Number(credits.credits_available ?? 0),
    creditsUsed: Number(credits.credits_used ?? 0),
    periodStart: credits.period_start,
    periodEnd: credits.period_end,
    activePromotions: activePromotions.map(toPublicPromotion),
    availablePromotionTypes: config.availablePromotionTypes,
    lockedPromotionTypes: config.lockedPromotionTypes,
    promotionBenefits: explainPromotionBenefits(config.planKey),
    upgradeBenefits: promotionUpgradeBenefits(config.planKey),
  };
}

export async function recordPromotionImpression(env: Env, serverId: string, source: unknown, promotionId?: unknown) {
  return recordPromotionEvent(env, "promotion_impressions", serverId, source, promotionId);
}

export async function recordPromotionClick(env: Env, serverId: string, source: unknown, promotionId?: unknown) {
  return recordPromotionEvent(env, "promotion_clicks", serverId, source, promotionId);
}

export async function getPromotionAnalytics(env: Env, serverId: string) {
  await ensurePromotionSchema(env);
  const normalizedServerId = cleanIdentifier(serverId);
  if (!normalizedServerId) throw new PromotionError("SERVER_NOT_FOUND", "Server not found.", 404);

  const credits = await ensurePromotionCreditsForCurrentPeriod(env, normalizedServerId);
  const activePromotions = await getActivePromotionsForServer(env, normalizedServerId);
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const db = requireDb(env);
  const [impressionsRow, clicksRow, recentRows] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS total FROM promotion_impressions WHERE server_id = ? AND occurred_at >= ?")
      .bind(normalizedServerId, cutoff)
      .first<PromotionAnalyticsCountRow>(),
    db
      .prepare("SELECT COUNT(*) AS total FROM promotion_clicks WHERE server_id = ? AND occurred_at >= ?")
      .bind(normalizedServerId, cutoff)
      .first<PromotionAnalyticsCountRow>(),
    db
      .prepare(
        `SELECT id, 'impression' AS type, source, promotion_id, occurred_at
         FROM promotion_impressions
         WHERE server_id = ?
         UNION ALL
         SELECT id, 'click' AS type, source, promotion_id, occurred_at
         FROM promotion_clicks
         WHERE server_id = ?
         ORDER BY occurred_at DESC
         LIMIT 12`,
      )
      .bind(normalizedServerId, normalizedServerId)
      .all<PromotionAnalyticsEventRow>(),
  ]);

  const impressionsLast7Days = Number(impressionsRow?.total ?? 0);
  const clicksLast7Days = Number(clicksRow?.total ?? 0);
  const recentPromotionEvents = (recentRows.results ?? []).map(toPublicAnalyticsEvent);
  return {
    impressionsLast7Days,
    clicksLast7Days,
    activePromotionCount: activePromotions.length,
    creditsUsedThisPeriod: Number(credits.credits_used ?? 0),
    estimatedVisibilityLift: estimateVisibilityLift(activePromotions, impressionsLast7Days, clicksLast7Days),
    recentPromotionEvents,
  };
}

export function explainPromotionBenefits(planKey: unknown) {
  const normalized = promotionPlanKey(planKey);
  if (normalized === "premium") {
    return [
      "8 monthly promotion credits.",
      "Directory bumps refresh discovery freshness.",
      "Featured rotation bumps are priority eligible.",
      "Spotlight boost eligibility is active for Premium exposure.",
    ];
  }
  if (normalized === "pro") {
    return [
      "2 monthly promotion credits.",
      "Directory bumps refresh discovery freshness.",
      "Featured rotation bumps are available.",
      "Premium adds Spotlight boosts and more monthly promotion credits.",
    ];
  }
  return [
    "Promotion options are visible.",
    "Upgrade to Pro for 2 monthly promotion credits or Premium for 8 credits and Spotlight boosts.",
  ];
}

export function normalizePromotionType(value: unknown): PromotionType | null {
  const text = String(value ?? "").trim().toLowerCase();
  return PROMOTION_TYPES.includes(text as PromotionType) ? text as PromotionType : null;
}

export async function ensurePromotionSchema(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS promotion_credits (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        plan_key TEXT NOT NULL,
        credits_available INTEGER NOT NULL DEFAULT 0,
        credits_used INTEGER NOT NULL DEFAULT 0,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_credits_server_period ON promotion_credits(server_id, period_start)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_credits_server ON promotion_credits(server_id, period_end)").run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_promotions (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        promotion_type TEXT NOT NULL,
        status TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        metadata_json TEXT
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_promotions_server_status ON server_promotions(server_id, status, ends_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_promotions_type_status ON server_promotions(promotion_type, status, ends_at)").run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS promotion_audit_log (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        old_value_json TEXT,
        new_value_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_audit_log_server ON promotion_audit_log(server_id, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_audit_log_action ON promotion_audit_log(action, created_at)").run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS promotion_impressions (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        promotion_id TEXT,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_impressions_server_time ON promotion_impressions(server_id, occurred_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_impressions_promotion_time ON promotion_impressions(promotion_id, occurred_at)").run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS promotion_clicks (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        promotion_id TEXT,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_clicks_server_time ON promotion_clicks(server_id, occurred_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_promotion_clicks_promotion_time ON promotion_clicks(promotion_id, occurred_at)").run();
}

function promotionPlanKey(planKey: unknown): "starter" | "pro" | "premium" {
  const normalized = normalizePlanKey(planKey);
  if (normalized === "premium" || normalized === "pro") return normalized;
  return "starter";
}

function typeStatus(promotionType: PromotionType, allowed: boolean, reason: string | null): PromotionTypeStatus {
  return {
    promotionType,
    label: promotionLabel(promotionType),
    allowed,
    reason,
    durationHours: DURATION_HOURS[promotionType],
  };
}

function promotionLabel(promotionType: PromotionType) {
  if (promotionType === "directory_bump") return "Directory bump";
  if (promotionType === "featured_rotation") return "Featured rotation";
  if (promotionType === "spotlight_boost") return "Spotlight boost";
  return "Seasonal push";
}

function lockedReason(planKey: "starter" | "pro" | "premium", promotionType: PromotionType) {
  if (promotionType === "seasonal_push") return "Reserved for future seasonal campaigns.";
  if (planKey === "starter") return "Upgrade to Pro or Premium to use promotion credits.";
  if (planKey === "pro" && promotionType === "spotlight_boost") return "Spotlight boost requires Premium.";
  return "Not available on this plan.";
}

function promotionLockedMessage(planKey: "starter" | "pro" | "premium", promotionType: PromotionType) {
  return lockedReason(planKey, promotionType) ?? "Promotion type is not available on this plan.";
}

function promotionUpgradeBenefits(planKey: "starter" | "pro" | "premium") {
  if (planKey === "premium") return [];
  if (planKey === "pro") return ["Premium adds 8 monthly credits, Spotlight boosts, and premium discovery priority."];
  return [
    "Pro adds 2 monthly promotion credits and featured rotation bumps.",
    "Premium adds 8 monthly credits, priority featured rotation, premium discovery priority, and Spotlight boosts.",
  ];
}

async function findPromotionServer(env: Env, rawServerId: unknown): Promise<PromotionServerRow | null> {
  const serverId = cleanIdentifier(rawServerId);
  if (!serverId) return null;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              COALESCE(server_subscriptions.plan_key, 'starter') AS plan_key,
              server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions
         ON server_subscriptions.guild_id = linked_servers.guild_id
        AND lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')
       WHERE (linked_servers.id = ? OR linked_servers.nitrado_service_id = ? OR linked_servers.public_slug = ?)
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY server_subscriptions.updated_at DESC,
        server_subscriptions.created_at DESC
       LIMIT 1`,
    )
    .bind(serverId, serverId, serverId)
    .first<PromotionServerRow>();
}

async function findActivePromotion(env: Env, serverId: string, promotionType: PromotionType) {
  const now = new Date().toISOString();
  return requireDb(env)
    .prepare(
      `SELECT *
       FROM server_promotions
       WHERE server_id = ?
         AND promotion_type = ?
         AND status = 'active'
         AND ends_at > ?
       LIMIT 1`,
    )
    .bind(serverId, promotionType, now)
    .first<PromotionRow>();
}

async function logPromotionAudit(env: Env, input: {
  serverId: string;
  actorUserId: string | null;
  action: string;
  oldValue: unknown;
  newValue: unknown;
}) {
  await requireDb(env)
    .prepare(
      `INSERT INTO promotion_audit_log (
        id, server_id, actor_user_id, action, old_value_json, new_value_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.serverId,
      input.actorUserId,
      input.action,
      input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      input.newValue === undefined ? null : JSON.stringify(input.newValue),
      new Date().toISOString(),
    )
    .run();
}

async function recordPromotionEvent(
  env: Env,
  tableName: "promotion_impressions" | "promotion_clicks",
  serverId: string,
  source: unknown,
  promotionId?: unknown,
) {
  await ensurePromotionSchema(env);
  const server = await findPromotionServer(env, serverId);
  if (!server) throw new PromotionError("SERVER_NOT_FOUND", "Server not found.", 404);
  const normalizedPromotionId = cleanOptionalIdentifier(promotionId);
  const safeSource = cleanPromotionSource(source);
  const occurredAt = new Date().toISOString();
  await requireDb(env)
    .prepare(`INSERT INTO ${tableName} (id, server_id, promotion_id, source, occurred_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), server.id, normalizedPromotionId, safeSource, occurredAt)
    .run();
  return { ok: true, serverId: server.id, source: safeSource, promotionId: normalizedPromotionId, occurredAt };
}

function toPublicPromotion(row: PromotionRow) {
  return {
    id: row.id,
    promotionType: row.promotion_type,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    label: promotionLabel(row.promotion_type),
  };
}

function toPublicAnalyticsEvent(row: PromotionAnalyticsEventRow): PromotionAnalyticsEvent {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    promotionId: row.promotion_id,
    occurredAt: row.occurred_at,
  };
}

function estimateVisibilityLift(activePromotions: PromotionRow[], impressions: number, clicks: number) {
  const promotionLift: Record<PromotionType, number> = {
    directory_bump: 8,
    featured_rotation: 14,
    spotlight_boost: 24,
    seasonal_push: 0,
  };
  const activeLift = activePromotions.reduce((total, promotion) => total + (promotionLift[promotion.promotion_type] ?? 0), 0);
  const engagementLift = Math.min(10, impressions / 20) + Math.min(12, clicks * 2);
  return Math.min(75, Math.round(activeLift + engagementLift));
}

function currentPeriod(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function cleanIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-_]{2,120}$/.test(value) ? value : null;
}

function cleanOptionalIdentifier(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return cleanIdentifier(value);
}

function cleanPromotionSource(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  const cleaned = text.replace(/[^a-z0-9:_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return cleaned || "unknown";
}
