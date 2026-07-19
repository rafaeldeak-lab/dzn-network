import { defaultBumpPeriod, evaluateListingBumpEligibility, periodExpired } from "../../../../_lib/advertising";
import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { ensureBillingSchema, getListingLimits, getOwnerEntitlements, getPlanConfig, type PlanEntitlements } from "../../../../_lib/plans";
import { recordDiscordServerAnnouncementEvent } from "../../../../_lib/discord-server-announcements";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params, waitUntil }) => {
  if (request.method !== "POST" && request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  await ensureBillingSchema(env);
  const db = requireDb(env);
  const server = await db
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string; user_id: string }>();
  if (!server) return json({ error: "Linked server not found" }, { status: 404 });
  if (server.user_id !== user.id) return json({ error: "No access to this linked server." }, { status: 403 });

  const entitlements = request.method === "GET"
    ? await getOwnerEntitlementsReadOnly(env, user.discord_id)
    : await getOwnerEntitlements(env, user.discord_id);
  const now = new Date();
  const listingPlanInput = { plan_key: entitlements.plan_key, subscription_status: entitlements.plan_key === "free" ? "free" : "active" };
  const listingLimits = getListingLimits(listingPlanInput);
  const billing = await db
    .prepare("SELECT current_period_start, current_period_end FROM owner_billing_accounts WHERE discord_user_id = ? LIMIT 1")
    .bind(user.discord_id)
    .first<{ current_period_start: string | null; current_period_end: string | null }>();
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
      advertising: {
        last_bumped_at: typeof state?.last_bumped_at === "string" ? state.last_bumped_at : null,
        bump_count_current_period: Number(state?.bump_count_current_period ?? 0),
        bump_period_start: typeof state?.bump_period_start === "string" ? state.bump_period_start : periodStart,
        bump_period_end: typeof state?.bump_period_end === "string" ? state.bump_period_end : periodEnd,
        next_bump_at: typeof state?.next_bump_at === "string" ? state.next_bump_at : null,
        bump_cooldown_days: listingLimits.bumpCooldownDays,
      },
      listing: listingLimits,
      entitlements,
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
  await db
    .prepare(
      `INSERT INTO server_advertising_state (
        linked_server_id, owner_discord_id, last_bumped_at, next_bump_at,
        bump_count_current_period, bump_period_start, bump_period_end,
        featured_until, featured_label, updated_at
      ) VALUES (?, ?, NULL, NULL, 0, ?, ?, NULL, NULL, ?)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        owner_discord_id = excluded.owner_discord_id,
        bump_period_start = COALESCE(server_advertising_state.bump_period_start, excluded.bump_period_start),
        bump_period_end = COALESCE(server_advertising_state.bump_period_end, excluded.bump_period_end),
        updated_at = excluded.updated_at`,
    )
    .bind(linkedServerId, user.discord_id, periodStart, periodEnd, nowIso)
    .run();

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
        RETURNING last_bumped_at, next_bump_at, bump_count_current_period, bump_period_start, bump_period_end`,
    )
    .bind(user.discord_id, nowIso, nextBumpAt, periodStart, periodEnd, nowIso, linkedServerId, user.discord_id, nowIso)
    .first<Record<string, unknown>>();
  if (!updated) {
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
    advertising: {
      last_bumped_at: typeof updated.last_bumped_at === "string" ? updated.last_bumped_at : nowIso,
      next_bump_at: typeof updated.next_bump_at === "string" ? updated.next_bump_at : nextBumpAt,
      bump_count_current_period: Number(updated.bump_count_current_period ?? nextCount),
      bump_period_start: typeof updated.bump_period_start === "string" ? updated.bump_period_start : periodStart,
      bump_period_end: typeof updated.bump_period_end === "string" ? updated.bump_period_end : periodEnd,
      bump_cooldown_days: listingLimits.bumpCooldownDays,
    },
    listing: listingLimits,
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
