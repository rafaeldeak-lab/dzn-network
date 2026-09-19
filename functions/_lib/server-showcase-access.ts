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

const ACTIVE_SHOWCASE_GRANT_FROM_SQL = activeShowcaseGrantFromSql("?");
const ACTIVE_SHOWCASE_GRANT_FROM_SQL_AT_DB_TIME = activeShowcaseGrantFromSql("'now'");
export const ACTIVE_SHOWCASE_GRANT_SQL = `SELECT grant_row.id, grant_row.expires_at ${ACTIVE_SHOWCASE_GRANT_FROM_SQL} LIMIT 1`;

type BillingInput = { plan_key: string | null; subscription_status: string | null };
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
    observedAt: fallbackObservedAt, billingPlan: billing.plan_key, billingStatus: billing.subscription_status,
    listing: getListingLimits(billing) };
  if (linkedServerId !== NUKETOWN_SHOWCASE_SCOPE.linkedServerId) return base;
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
export function showcaseWriteGuard(serverId: string, expectedOwnerUserId: string, access: ServerShowcaseAccess) {
  const sql = `EXISTS (SELECT 1 FROM linked_servers AS write_server
    WHERE write_server.id = ? AND write_server.user_id = ?
      AND lower(COALESCE(write_server.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
      AND COALESCE(write_server.merged_into_server_id, '') = '')`;
  const values: Array<string | null> = [serverId, expectedOwnerUserId];
  if (access.source === "complimentary_showcase") {
    const now = new Date().toISOString();
    return { sql: `${sql} AND EXISTS (SELECT 1 ${ACTIVE_SHOWCASE_GRANT_FROM_SQL} AND grant_row.id = ?)`,
      values: [...values, ...showcaseScopeBindings(), now, now, access.grantId] };
  }
  return { sql: `${sql} AND EXISTS (SELECT 1 FROM linked_servers AS billing_server
      LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = billing_server.guild_id
      WHERE billing_server.id = ? AND COALESCE(server_subscriptions.plan_key, 'free') = ?
        AND server_subscriptions.status IS ?)`,
    values: [...values, serverId, access.billingPlan ?? "free", access.billingStatus] };
}

export function isMissingShowcaseSchema(error: unknown) {
  return /no such table: (?:main\.)?server_showcase_grants\b/i.test(error instanceof Error ? error.message : String(error));
}
