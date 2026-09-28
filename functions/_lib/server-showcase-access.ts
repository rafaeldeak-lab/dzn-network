import { requireDb } from "./db";
import { canUseProFeature, getListingLimits, normalizeListingPlanKey } from "./plans";
import type { Env } from "./types";

// The website guild is deliberately not the separate bot's operations guild.
export const NUKETOWN_SHOWCASE_SCOPE = Object.freeze({
  linkedServerId: "8741ac30-84ba-41e2-93e8-d584cdc81c89",
  ownerUserId: "7df55354-77b4-4f85-aee9-81d0e6deba0a",
  ownerDiscordId: "831243159785701398",
  guildId: "1504922257481531402",
  nitradoServiceId: "18765761",
});

export const SHOWCASE_SCOPE_SQL = `linked_servers.id = ? AND linked_servers.user_id = ?
  AND users.discord_id = ? AND linked_servers.guild_id = ? AND linked_servers.nitrado_service_id = ?
  AND lower(COALESCE(linked_servers.status, '')) = 'live'
  AND lower(COALESCE(linked_servers.lifecycle_status, '')) = 'active_live'
  AND COALESCE(linked_servers.merged_into_server_id, '') = ''`;

export function showcaseScopeBindings() {
  const scope = NUKETOWN_SHOWCASE_SCOPE;
  return [scope.linkedServerId, scope.ownerUserId, scope.ownerDiscordId, scope.guildId, scope.nitradoServiceId];
}

function activeShowcaseGrantFromSql(nowExpression: string) {
  return `FROM server_showcase_grants AS grant_row
  JOIN linked_servers ON linked_servers.id = grant_row.linked_server_id
  JOIN users ON users.id = linked_servers.user_id
  WHERE ${SHOWCASE_SCOPE_SQL}
    AND grant_row.owner_user_id = linked_servers.user_id
    AND grant_row.owner_discord_id = users.discord_id
    AND grant_row.guild_id = linked_servers.guild_id
    AND grant_row.nitrado_service_id = linked_servers.nitrado_service_id
    AND grant_row.plan_key = 'pro' AND grant_row.purpose = 'platform_owner_showcase'
    AND grant_row.revoked_at IS NULL
    AND julianday(grant_row.created_at) <= julianday(${nowExpression})
    AND (grant_row.expires_at IS NULL OR julianday(grant_row.expires_at) > julianday(${nowExpression}))`;
}

const ACTIVE_SHOWCASE_GRANT_FROM_SQL_AT_DB_TIME = activeShowcaseGrantFromSql("'now'");
export const ACTIVE_SHOWCASE_GRANT_AT_DB_TIME_SQL = `SELECT grant_row.id, grant_row.expires_at ${ACTIVE_SHOWCASE_GRANT_FROM_SQL_AT_DB_TIME} LIMIT 1`;
const SHOWCASE_WRITE_ASSERTION_FAILURE = /integer overflow/i;

export function isAutomationBillingEligible(planKey: unknown, status: unknown) {
  const normalizedPlan = String(planKey ?? "free").trim().toLowerCase();
  const normalizedStatus = String(status ?? "inactive").trim().toLowerCase();
  return normalizedStatus === "active" || normalizedStatus === "trialing"
    || (normalizedPlan === "free" && (normalizedStatus === "free" || normalizedStatus === "inactive"));
}

export function automationBillingEligibilitySql(alias: "paid" | "automation_entitlements" | "server_subscriptions") {
  return `(lower(COALESCE(${alias}.status, 'inactive')) IN ('active', 'trialing')
    OR (lower(COALESCE(${alias}.plan_key, 'free')) = 'free'
      AND lower(COALESCE(${alias}.status, 'inactive')) IN ('free', 'inactive')))`;
}

export function showcaseAutomationEntitlementCteSql() {
  return `WITH complimentary_automation_entitlements AS (
    SELECT entitlement_server.id AS linked_server_id, entitlement_server.guild_id,
           'pro' AS plan_key, 'active' AS status,
           'complimentary_showcase' AS access_source
    FROM linked_servers AS entitlement_server
    WHERE entitlement_server.id = ?
      AND EXISTS (${ACTIVE_SHOWCASE_GRANT_AT_DB_TIME_SQL})
      AND NOT EXISTS (
        SELECT 1 FROM server_subscriptions AS paid_pro
        WHERE paid_pro.guild_id = entitlement_server.guild_id
          AND lower(COALESCE(paid_pro.status, '')) IN ('active', 'trialing')
          AND lower(COALESCE(paid_pro.plan_key, '')) IN ('pro', 'premium', 'network', 'partner')
      )
  ),
  automation_entitlements AS (
    SELECT paid_server.id AS linked_server_id, paid.guild_id, paid.plan_key, paid.status,
           'billing' AS access_source
    FROM server_subscriptions AS paid
    JOIN linked_servers AS paid_server ON paid_server.guild_id = paid.guild_id
    WHERE ${automationBillingEligibilitySql("paid")}
      AND NOT EXISTS (
        SELECT 1 FROM complimentary_automation_entitlements AS complimentary
        WHERE complimentary.linked_server_id = paid_server.id
      )
    UNION ALL
    SELECT linked_server_id, guild_id, plan_key, status, access_source
    FROM complimentary_automation_entitlements
  )`;
}

export function showcaseAutomationEntitlementBindings() {
  return [NUKETOWN_SHOWCASE_SCOPE.linkedServerId, ...showcaseScopeBindings()];
}

type BillingInput = { plan_key: string | null; subscription_status: string | null; observed_at?: string | null };
export type ServerShowcaseAccess = {
  source: "complimentary_showcase" | "billing";
  grantId: string | null;
  expiresAt: string | null;
  observedAt: string;
  billingPlan: string | null;
  billingStatus: string | null;
  listing: ReturnType<typeof getListingLimits>;
};

const ACTIVE_SHOWCASE_GRANT_OBSERVATION_SQL = `WITH active_grant AS (
  SELECT grant_row.id, grant_row.expires_at ${ACTIVE_SHOWCASE_GRANT_FROM_SQL_AT_DB_TIME} LIMIT 1
)
SELECT active_grant.id, active_grant.expires_at,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS observed_at
FROM (SELECT 1) AS observation
LEFT JOIN active_grant ON 1 = 1
LIMIT 1`;

export async function readServerShowcaseAccess(env: Env, linkedServerId: string, billing: BillingInput): Promise<ServerShowcaseAccess> {
  const fallbackObservedAt = new Date().toISOString();
  const base: ServerShowcaseAccess = { source: "billing", grantId: null, expiresAt: null,
    observedAt: billing.observed_at ?? fallbackObservedAt, billingPlan: billing.plan_key, billingStatus: billing.subscription_status,
    listing: getListingLimits(billing) };
  if (linkedServerId !== NUKETOWN_SHOWCASE_SCOPE.linkedServerId) return base;
  if (base.listing.listingPlanKey === "pro") return base;
  let grant: { id: string | null; expires_at: string | null; observed_at: string | null } | null;
  try {
    grant = await requireDb(env).prepare(ACTIVE_SHOWCASE_GRANT_OBSERVATION_SQL)
      .bind(...showcaseScopeBindings()).first<typeof grant>();
  } catch (error) {
    // Additive rollout: an unapplied migration cannot grant access or break existing billing.
    if (isMissingShowcaseSchema(error)) return base;
    throw error;
  }
  const observedAt = grant?.observed_at ?? fallbackObservedAt;
  if (!grant?.id) return { ...base, observedAt };
  return { ...base, source: "complimentary_showcase", grantId: grant.id, expiresAt: grant.expires_at, observedAt,
    listing: getListingLimits("pro", "active") };
}

export function canUseShowcaseFeature(access: ServerShowcaseAccess, feature: Parameters<typeof canUseProFeature>[1]) {
  return access.source === "complimentary_showcase" || canUseProFeature({
    plan_key: access.billingPlan, subscription_status: access.billingStatus,
  }, feature);
}

export function serializeShowcaseAccess(access: ServerShowcaseAccess) {
  return { source: access.source,
    effectiveListingPlan: access.source === "complimentary_showcase" ? "pro"
      : normalizeListingPlanKey(access.billingPlan, access.billingStatus),
    expiresAt: access.expiresAt };
}

// Recheck identity and the capability source inside the transaction that saves a protected edit.
export async function showcaseWriteGuard(env: Env, serverId: string, expectedOwnerUserId: string, access: ServerShowcaseAccess) {
  const sql = `EXISTS (SELECT 1 FROM linked_servers AS write_server
    WHERE write_server.id = ? AND write_server.user_id = ?
      AND lower(COALESCE(write_server.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
      AND COALESCE(write_server.merged_into_server_id, '') = '')`;
  const values: Array<string | null> = [serverId, expectedOwnerUserId];
  if (access.source === "complimentary_showcase") {
    return { sql: `${sql} AND EXISTS (SELECT 1 ${ACTIVE_SHOWCASE_GRANT_FROM_SQL_AT_DB_TIME} AND grant_row.id = ?)`,
      values: [...values, ...showcaseScopeBindings(), access.grantId] };
  }
  return { sql: `${sql} AND EXISTS (SELECT 1 FROM linked_servers AS billing_server
      LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = billing_server.guild_id
      WHERE billing_server.id = ? AND COALESCE(server_subscriptions.plan_key, 'free') = ?
        AND server_subscriptions.status IS ?)`,
    values: [...values, serverId, access.billingPlan ?? "free", access.billingStatus] };
}

// A failed first statement aborts a D1 batch before any protected mutation runs.
export function showcaseWriteAssertionSql(guardSql: string) {
  return `SELECT CASE WHEN (${guardSql}) THEN 1 ELSE abs(-9223372036854775808) END AS allowed`;
}

export function isShowcaseWriteAssertionError(error: unknown) {
  return SHOWCASE_WRITE_ASSERTION_FAILURE.test(error instanceof Error ? error.message : String(error));
}

export function isMissingShowcaseSchema(error: unknown) {
  return /no such table: (?:main\.)?server_showcase_grants\b/i.test(error instanceof Error ? error.message : String(error));
}
