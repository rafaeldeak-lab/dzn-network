import { defaultBumpPeriod, evaluateBumpEligibility, periodExpired } from "../../../../_lib/advertising";
import { ensureMockUser, getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { isMockAuth } from "../../../../_lib/mock";
import { ensureBillingSchema, getOwnerEntitlements } from "../../../../_lib/plans";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
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

  const entitlements = await getOwnerEntitlements(env, user.discord_id);
  const now = new Date();
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
        included_bumps_per_month: entitlements.included_bumps_per_month,
        bump_cooldown_hours: entitlements.bump_cooldown_hours,
      },
      entitlements,
    });
  }

  const eligibility = evaluateBumpEligibility({ entitlements, state, now });
  if (!eligibility.ok) {
    const status = eligibility.code === "upgrade_required" ? 402 : 429;
    return json({ error: eligibility.reason, code: eligibility.code, retry_after_hours: "retry_after_hours" in eligibility ? eligibility.retry_after_hours : null }, { status });
  }

  const nowIso = now.toISOString();
  const nextCount = Number(state?.bump_count_current_period ?? 0) + 1;
  await db
    .prepare(
      `INSERT INTO server_advertising_state (
        linked_server_id, owner_discord_id, last_bumped_at, bump_count_current_period,
        bump_period_start, bump_period_end, featured_until, featured_label, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(linked_server_id) DO UPDATE SET
        owner_discord_id = excluded.owner_discord_id,
        last_bumped_at = excluded.last_bumped_at,
        bump_count_current_period = excluded.bump_count_current_period,
        bump_period_start = excluded.bump_period_start,
        bump_period_end = excluded.bump_period_end,
        updated_at = excluded.updated_at`,
    )
    .bind(linkedServerId, user.discord_id, nowIso, nextCount, periodStart, periodEnd, nowIso)
    .run();
  await db
    .prepare("INSERT INTO server_ad_bump_events (id, linked_server_id, owner_discord_id, bump_type, created_at) VALUES (?, ?, ?, 'included', ?)")
    .bind(crypto.randomUUID(), linkedServerId, user.discord_id, nowIso)
    .run();

  console.log("DZN SERVER BUMPED", { linkedServerId });
  return json({
    ok: true,
    advertising: {
      last_bumped_at: nowIso,
      bump_count_current_period: nextCount,
      bump_period_start: periodStart,
      bump_period_end: periodEnd,
      included_bumps_per_month: entitlements.included_bumps_per_month,
      bump_cooldown_hours: entitlements.bump_cooldown_hours,
    },
  });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}
