import { defaultBumpPeriod, evaluateListingBumpEligibility, periodExpired } from "../../../../_lib/advertising";
import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { ensureBillingSchema, getOwnerEntitlements, getPlanConfig, type PlanEntitlements } from "../../../../_lib/plans";
import { recordDiscordServerAnnouncementEvent } from "../../../../_lib/discord-server-announcements";
import { readServerShowcaseAccess, serializeShowcaseAccess, showcaseWriteGuard } from "../../../../_lib/server-showcase-access";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params, waitUntil }) => {
  if (request.method !== "POST" && request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  if (request.method === "POST") await ensureBillingSchema(env);
  const db = requireDb(env);
  const server = await db
    .prepare(
      `SELECT linked_servers.id, linked_servers.user_id, linked_servers.status, linked_servers.lifecycle_status,
              (SELECT server_subscriptions.plan_key
               FROM server_subscriptions
               WHERE server_subscriptions.guild_id = linked_servers.guild_id
                 AND server_subscriptions.owner_discord_id = ?
               ORDER BY CASE WHEN lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing') THEN 0 ELSE 1 END,
                        server_subscriptions.updated_at DESC,
                        server_subscriptions.created_at DESC
               LIMIT 1) AS server_plan_key,
              (SELECT server_subscriptions.status
               FROM server_subscriptions
               WHERE server_subscriptions.guild_id = linked_servers.guild_id
                 AND server_subscriptions.owner_discord_id = ?
               ORDER BY CASE WHEN lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing') THEN 0 ELSE 1 END,
                        server_subscriptions.updated_at DESC,
                        server_subscriptions.created_at DESC
               LIMIT 1) AS server_subscription_status
       FROM linked_servers
       WHERE linked_servers.id = ?
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(user.discord_id, user.discord_id, linkedServerId)
    .first<{
      id: string;
      user_id: string;
      status: string | null;
      lifecycle_status: string | null;
      server_plan_key: string | null;
      server_subscription_status: string | null;
    }>();
  if (!server) return json({ error: "Linked server not found" }, { status: 404 });
  if (server.user_id !== user.id) return json({ error: "No access to this linked server." }, { status: 403 });

  const entitlements = request.method === "GET"
    ? await getOwnerEntitlementsReadOnly(env, user.discord_id)
    : await getOwnerEntitlements(env, user.discord_id);
  const now = new Date();
  const billing = await readOwnerBillingProjection(env, user.discord_id, request.method === "GET");
  const accessBaseline = {
    plan_key: server.server_plan_key ?? billing?.plan_key ?? entitlements.plan_key,
    subscription_status: server.server_plan_key
      ? server.server_subscription_status
      : billing?.plan_status ?? (entitlements.plan_key === "free" ? "free" : "active"),
  };
  const serverAccess = await readServerShowcaseAccess(env, linkedServerId, accessBaseline);
  const listingLimits = serverAccess.listing;
  const serverPlan = getPlanConfig(listingLimits.listingPlanKey);
  const fallbackPeriod = defaultBumpPeriod(now);
  const periodStart = billing?.current_period_start ?? fallbackPeriod.start;
  const periodEnd = billing?.current_period_end ?? fallbackPeriod.end;

  let state = await db
    .prepare("SELECT * FROM server_advertising_state WHERE linked_server_id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<Record<string, unknown>>();
  if (periodExpired(state?.bump_period_end as string | null | undefined, now)) {
    state = {
      ...state,
      bump_count_current_period: 0,
      bump_period_start: periodStart,
      bump_period_end: periodEnd,
    };
  }

  if (request.method === "GET") {
    return json({
      ok: true,
      generated_at: now.toISOString(),
      advertising: {
        last_bumped_at: typeof state?.last_bumped_at === "string" ? state.last_bumped_at : null,
        bump_count_current_period: Number(state?.bump_count_current_period ?? 0),
        bump_period_start: typeof state?.bump_period_start === "string" ? state.bump_period_start : periodStart,
        bump_period_end: typeof state?.bump_period_end === "string" ? state.bump_period_end : periodEnd,
        next_bump_at: typeof state?.next_bump_at === "string" ? state.next_bump_at : null,
        included_bumps_per_month: serverPlan.included_bumps_per_month,
        bump_cooldown_hours: listingLimits.bumpCooldownDays * 24,
        bump_cooldown_days: listingLimits.bumpCooldownDays,
        access_source: serverAccess.source,
        effective_listing_plan: listingLimits.listingPlanKey,
        listing_label: listingLimits.publicLabel,
      },
      listing: listingLimits,
      entitlements,
      server_access: serializeShowcaseAccess(serverAccess),
    });
  }

  await ensureListingEventsSchema(env);
  const rateLimited = await isBumpAttemptRateLimited(env, user.id, now);
  if (rateLimited) {
    return json({ error: "Please try again shortly.", code: "rate_limited", retry_after_seconds: 60 }, { status: 429 });
  }
  await recordListingEvent(env, linkedServerId, "bump_attempt", user.id, { plan: listingLimits.listingPlanKey }, now.toISOString());

  const eligibility = evaluateListingBumpEligibility({ limits: listingLimits, state, now });
  if (!eligibility.ok) {
    return json({
      error: eligibility.reason,
      code: eligibility.code,
      next_bump_at: eligibility.next_bump_at,
      retry_after_seconds: eligibility.retry_after_seconds,
      retry_after_days: eligibility.retry_after_days,
    }, { status: 429 });
  }

  const nowIso = now.toISOString();
  const nextBumpAt = addDaysIso(nowIso, listingLimits.bumpCooldownDays);
  const accessGuard = serverAccess.source === "complimentary_showcase"
    ? showcaseWriteGuard(linkedServerId, server.user_id, serverAccess)
    : billingAdvertisingWriteGuard(
        linkedServerId,
        server.user_id,
        user.discord_id,
        server.status,
        server.lifecycle_status,
        serverAccess,
      );
  const stateReady = await db
    .prepare(
      `INSERT INTO server_advertising_state (
        linked_server_id, owner_discord_id, last_bumped_at, next_bump_at,
        bump_count_current_period, bump_period_start, bump_period_end,
        featured_until, featured_label, updated_at
      ) SELECT ?, ?, NULL, NULL, 0, ?, ?, NULL, NULL, ? WHERE ${accessGuard.sql}
      ON CONFLICT(linked_server_id) DO UPDATE SET
        owner_discord_id = excluded.owner_discord_id,
        bump_period_start = COALESCE(server_advertising_state.bump_period_start, excluded.bump_period_start),
        bump_period_end = COALESCE(server_advertising_state.bump_period_end, excluded.bump_period_end),
        updated_at = excluded.updated_at
      RETURNING linked_server_id`,
    )
    .bind(linkedServerId, user.discord_id, periodStart, periodEnd, nowIso, ...accessGuard.values)
    .first<{ linked_server_id: string }>();
  if (!stateReady) {
    return json({
      error: "Server access changed. Refresh before bumping again.",
      code: "access_changed",
    }, { status: 409 });
  }

  const nextCount = Number(state?.bump_count_current_period ?? 0) + 1;
  const updated = await db
    .prepare(
      `UPDATE server_advertising_state
          SET owner_discord_id = ?,
              last_bumped_at = ?,
              next_bump_at = ?,
              bump_count_current_period = COALESCE(bump_count_current_period, 0) + 1,
              bump_period_start = ?,
              bump_period_end = ?,
              updated_at = ?
        WHERE linked_server_id = ?
          AND owner_discord_id = ?
          AND (next_bump_at IS NULL OR datetime(next_bump_at) <= datetime(?))
          AND ${accessGuard.sql}
        RETURNING last_bumped_at, next_bump_at, bump_count_current_period, bump_period_start, bump_period_end`,
    )
    .bind(
      user.discord_id,
      nowIso,
      nextBumpAt,
      periodStart,
      periodEnd,
      nowIso,
      linkedServerId,
      user.discord_id,
      nowIso,
      ...accessGuard.values,
    )
    .first<Record<string, unknown>>();
  if (!updated) {
    const accessStillMatches = await db
      .prepare(`SELECT 1 AS allowed WHERE ${accessGuard.sql}`)
      .bind(...accessGuard.values)
      .first<{ allowed: number }>();
    if (!accessStillMatches) {
      return json({
        error: "Server access changed. Refresh before bumping again.",
        code: "access_changed",
      }, { status: 409 });
    }
    const latestState = await db.prepare("SELECT * FROM server_advertising_state WHERE linked_server_id = ? LIMIT 1").bind(linkedServerId).first<Record<string, unknown>>();
    const latestEligibility = evaluateListingBumpEligibility({ limits: listingLimits, state: latestState, now });
    return json({
      error: latestEligibility.ok ? "Bump already processed. Refresh the page to see the latest status." : latestEligibility.reason,
      code: latestEligibility.ok ? "already_processed" : latestEligibility.code,
      next_bump_at: latestEligibility.ok ? nextBumpAt : latestEligibility.next_bump_at,
      retry_after_seconds: latestEligibility.ok ? listingLimits.bumpCooldownDays * 24 * 60 * 60 : latestEligibility.retry_after_seconds,
    }, { status: 429 });
  }
  await db
    .prepare("INSERT INTO server_ad_bump_events (id, linked_server_id, owner_discord_id, bump_type, created_at) VALUES (?, ?, ?, 'included', ?)")
    .bind(crypto.randomUUID(), linkedServerId, user.discord_id, nowIso)
    .run();
  await recordListingEvent(env, linkedServerId, "bump_success", user.id, { plan: listingLimits.listingPlanKey, next_bump_at: nextBumpAt }, nowIso);
  waitUntil(
    recordDiscordServerAnnouncementEvent(env, {
      eventType: "server_bump",
      serverId: linkedServerId,
      planKey: listingLimits.listingPlanKey,
      reason: "server_listing_bump",
    }).catch((error) => {
      console.warn("DZN Discord bump announcement skipped", {
        linkedServerId,
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }),
  );

  console.log("DZN SERVER BUMPED", { linkedServerId });
  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    advertising: {
      last_bumped_at: typeof updated.last_bumped_at === "string" ? updated.last_bumped_at : nowIso,
      next_bump_at: typeof updated.next_bump_at === "string" ? updated.next_bump_at : nextBumpAt,
      bump_count_current_period: Number(updated.bump_count_current_period ?? nextCount),
      bump_period_start: typeof updated.bump_period_start === "string" ? updated.bump_period_start : periodStart,
      bump_period_end: typeof updated.bump_period_end === "string" ? updated.bump_period_end : periodEnd,
      included_bumps_per_month: serverPlan.included_bumps_per_month,
      bump_cooldown_hours: listingLimits.bumpCooldownDays * 24,
      bump_cooldown_days: listingLimits.bumpCooldownDays,
      access_source: serverAccess.source,
      effective_listing_plan: listingLimits.listingPlanKey,
      listing_label: listingLimits.publicLabel,
    },
    listing: listingLimits,
    server_access: serializeShowcaseAccess(serverAccess),
  });
};

async function getOwnerEntitlementsReadOnly(env: Env, discordUserId: string): Promise<PlanEntitlements> {
  try {
    const row = await requireDb(env)
      .prepare("SELECT * FROM owner_plan_entitlements WHERE discord_user_id = ? LIMIT 1")
      .bind(discordUserId)
      .first<Record<string, unknown>>();
    return row ? entitlementsFromReadonlyRow(row) : getPlanConfig("free");
  } catch {
    return getPlanConfig("free");
  }
}

type OwnerBillingProjection = {
  plan_key: string | null;
  plan_status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

async function readOwnerBillingProjection(env: Env, discordUserId: string, allowMissingSchema: boolean) {
  try {
    return await requireDb(env)
      .prepare("SELECT plan_key, plan_status, current_period_start, current_period_end FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
      .bind(discordUserId)
      .first<OwnerBillingProjection>();
  } catch (error) {
    if (allowMissingSchema && /no such table: (?:main\.)?owner_billing_accounts\b/i.test(error instanceof Error ? error.message : String(error))) {
      return null;
    }
    throw error;
  }
}

function entitlementsFromReadonlyRow(row: Record<string, unknown>): PlanEntitlements {
  const base = getPlanConfig(row.plan_key);
  return {
    ...base,
    max_linked_servers: Number(row.max_linked_servers ?? base.max_linked_servers),
    can_use_reviews: Number(row.can_use_reviews ?? (base.can_use_reviews ? 1 : 0)) === 1,
    can_use_public_listing: Number(row.can_use_public_listing ?? (base.can_use_public_listing ? 1 : 0)) === 1,
    can_use_advanced_analytics: Number(row.can_use_advanced_analytics ?? (base.can_use_advanced_analytics ? 1 : 0)) === 1,
    can_join_events: Number(row.can_join_events ?? (base.can_join_events ? 1 : 0)) === 1,
    can_use_ad_bumps: Number(row.can_use_ad_bumps ?? (base.can_use_ad_bumps ? 1 : 0)) === 1,
    included_bumps_per_month: Number(row.included_bumps_per_month ?? base.included_bumps_per_month),
    bump_cooldown_hours: Number(row.bump_cooldown_hours ?? base.bump_cooldown_hours),
    can_use_featured_slots: Number(row.can_use_featured_slots ?? (base.can_use_featured_slots ? 1 : 0)) === 1,
    stat_history_days: Number(row.stat_history_days ?? base.stat_history_days),
    public_publish_interval_minutes: Number(row.public_publish_interval_minutes ?? base.public_publish_interval_minutes),
    visibility_weight: Number(row.visibility_weight ?? base.visibility_weight),
  };
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  return getSessionUser(env, request);
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

async function ensureListingEventsSchema(env: Env) {
  const db = requireDb(env);
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS server_listing_events (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      user_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    )`,
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_listing_events_server_type_created ON server_listing_events(server_id, event_type, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_listing_events_user_type_created ON server_listing_events(user_id, event_type, created_at)").run();
}

async function isBumpAttemptRateLimited(env: Env, userId: string, now: Date) {
  const windowStart = new Date(now.getTime() - 60 * 1000).toISOString();
  const row = await requireDb(env)
    .prepare(
      `SELECT COUNT(*) AS count
         FROM server_listing_events
        WHERE user_id = ?
          AND event_type = 'bump_attempt'
          AND datetime(created_at) >= datetime(?)`,
    )
    .bind(userId, windowStart)
    .first<{ count: number | null }>();
  return Number(row?.count ?? 0) >= 5;
}

async function recordListingEvent(env: Env, serverId: string, eventType: string, userId: string | null, metadata: Record<string, unknown>, createdAt: string) {
  await requireDb(env)
    .prepare(
      `INSERT INTO server_listing_events (id, server_id, event_type, source, user_id, metadata_json, created_at)
       VALUES (?, ?, ?, 'web', ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), serverId, eventType, userId, JSON.stringify(metadata), createdAt)
    .run();
}

function addDaysIso(value: string, days: number) {
  return new Date(Date.parse(value) + days * 24 * 60 * 60 * 1000).toISOString();
}

function billingAdvertisingWriteGuard(
  serverId: string,
  expectedOwnerUserId: string,
  expectedOwnerDiscordId: string,
  expectedStatus: string | null,
  expectedLifecycleStatus: string | null,
  access: Awaited<ReturnType<typeof readServerShowcaseAccess>>,
) {
  const selectedPlan = `(SELECT current_subscription.plan_key
    FROM server_subscriptions AS current_subscription
    WHERE current_subscription.guild_id = write_server.guild_id
      AND current_subscription.owner_discord_id = write_owner.discord_id
    ORDER BY CASE WHEN lower(COALESCE(current_subscription.status, '')) IN ('active', 'trialing') THEN 0 ELSE 1 END,
             current_subscription.updated_at DESC,
             current_subscription.created_at DESC
    LIMIT 1)`;
  const selectedStatus = `(SELECT current_subscription.status
    FROM server_subscriptions AS current_subscription
    WHERE current_subscription.guild_id = write_server.guild_id
      AND current_subscription.owner_discord_id = write_owner.discord_id
    ORDER BY CASE WHEN lower(COALESCE(current_subscription.status, '')) IN ('active', 'trialing') THEN 0 ELSE 1 END,
             current_subscription.updated_at DESC,
             current_subscription.created_at DESC
    LIMIT 1)`;
  const ownerPlan = `(SELECT current_billing.plan_key FROM owner_billing_accounts AS current_billing
    WHERE current_billing.discord_user_id = write_owner.discord_id LIMIT 1)`;
  const ownerStatus = `(SELECT current_billing.plan_status FROM owner_billing_accounts AS current_billing
    WHERE current_billing.discord_user_id = write_owner.discord_id LIMIT 1)`;
  const entitlementPlan = `(SELECT current_entitlement.plan_key FROM owner_plan_entitlements AS current_entitlement
    WHERE current_entitlement.discord_user_id = write_owner.discord_id LIMIT 1)`;
  const resolvedPlan = `COALESCE(${selectedPlan}, ${ownerPlan}, ${entitlementPlan}, 'free')`;
  const resolvedStatus = `CASE
    WHEN ${selectedPlan} IS NOT NULL THEN ${selectedStatus}
    ELSE COALESCE(${ownerStatus}, CASE WHEN COALESCE(${entitlementPlan}, 'free') = 'free' THEN 'free' ELSE 'active' END)
  END`;
  return {
    sql: `EXISTS (SELECT 1
      FROM linked_servers AS write_server
      JOIN users AS write_owner ON write_owner.id = write_server.user_id
      WHERE write_server.id = ?
        AND write_server.user_id = ?
        AND write_owner.discord_id = ?
        AND lower(COALESCE(write_server.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
        AND lower(COALESCE(write_server.status, 'pending')) = lower(?)
        AND COALESCE(write_server.lifecycle_status, '') = ?
        AND COALESCE(write_server.merged_into_server_id, '') = ''
        AND ${resolvedPlan} IS ?
        AND ${resolvedStatus} IS ?)`,
    values: [
      serverId,
      expectedOwnerUserId,
      expectedOwnerDiscordId,
      expectedStatus ?? "pending",
      expectedLifecycleStatus ?? "",
      access.billingPlan ?? "free",
      access.billingStatus,
    ],
  };
}
