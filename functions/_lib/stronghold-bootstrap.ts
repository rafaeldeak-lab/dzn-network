import { hmacSha256 } from "./crypto";
import { getSessionUser, MOCK_USER_ID, requireDb, SESSION_COOKIE } from "./db";
import { json, readCookie } from "./http";
import { isMockAuth } from "./mock";
import {
  evaluateStrongholdAccess,
  isCanonicalStrongholdServerId,
  STRONGHOLD_ACCESS_POLICY_VERSION,
  type StrongholdAccessSnapshot,
} from "./stronghold-access";
import type { Env } from "./types";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex" };
const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  json(body, { status, headers: { ...privateHeaders, ...extra } });

async function strictSessionExpiry(request: Request, env: Env, userId: string, secret: string): Promise<number | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hmacSha256(token, secret);
  const result = await requireDb(env).prepare(
    "SELECT user_id, expires_at FROM sessions WHERE session_token_hash = ? LIMIT 2",
  ).bind(tokenHash).all<{ user_id: string; expires_at: unknown }>();
  const rows = result.results ?? [];
  // Bind expiry to this exact cookie and the user resolved by the existing
  // helper. A different valid session for that user must not extend this one.
  if (!result.success || rows.length !== 1 || rows[0].user_id !== userId) return null;
  const expiresAt = rows[0].expires_at;
  // createSession writes UTC ISO strings. The existing helper's text comparison
  // with SQLite datetime('now') cannot reliably reject same-day ISO expiry.
  // Keep that helper unchanged and enforce this new route's strict UTC contract.
  if (typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expiresAt)) return null;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== expiresAt.slice(0, 19)) return null;
  return parsed > Date.now() ? parsed : null;
}

// All columns already exist at pinned DZN main 119f9627caf74e24c2dc650f3c9ea737c8ca8e4f.
// One statement reads the canonical server, real owner's billing projection and
// the authenticated user's membership. No ensure-schema helper or external call.
const ACCESS_SNAPSHOT_SQL = `SELECT
  linked.id AS server_id, linked.user_id AS owner_user_id, owner.discord_id AS owner_discord_id,
  linked.guild_id, linked.status AS server_status, linked.lifecycle_status, linked.merged_into_server_id,
  billing.discord_user_id AS billing_owner_discord_id,
  billing.plan_key AS owner_plan_key, billing.plan_status AS owner_plan_status,
  billing.stripe_customer_id AS owner_customer_id, billing.stripe_subscription_id AS owner_subscription_id,
  billing.current_period_start AS owner_period_start, billing.current_period_end AS owner_period_end,
  subscription.guild_id AS subscription_guild_id, subscription.owner_discord_id AS subscription_owner_discord_id,
  subscription.plan_key AS server_plan_key, subscription.status AS server_plan_status,
  subscription.stripe_customer_id AS server_customer_id, subscription.stripe_subscription_id AS server_subscription_id,
  subscription.current_period_start AS server_period_start, subscription.current_period_end AS server_period_end,
  membership.user_id AS membership_user_id, membership.guild_id AS membership_guild_id,
  membership.source AS membership_source, membership.last_seen_at AS membership_last_seen_at,
  membership.revoked_at AS membership_revoked_at
  FROM linked_servers AS linked
  INNER JOIN users AS owner ON owner.id = linked.user_id
  LEFT JOIN owner_billing_accounts AS billing ON billing.discord_user_id = owner.discord_id
  LEFT JOIN server_subscriptions AS subscription ON subscription.guild_id = linked.guild_id
  LEFT JOIN player_discord_community_memberships AS membership
    ON membership.user_id = ? AND membership.guild_id = linked.guild_id
  WHERE linked.id = ? LIMIT 1`;

export async function handleStrongholdBootstrap(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return reply({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
  try {
    // Never fall back to development authentication or a missing session secret.
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret?.trim() || isMockAuth(env.MOCK_AUTH)) return reply({ error: "UNAVAILABLE" }, 503);
    const user = await getSessionUser(env, request);
    if (!user || user.id === MOCK_USER_ID) return reply({ error: "UNAUTHENTICATED" }, 401);
    const sessionExpiresAt = await strictSessionExpiry(request, env, user.id, sessionSecret);
    if (sessionExpiresAt === null) return reply({ error: "UNAUTHENTICATED" }, 401);
    if (env.DZN_STRONGHOLD_BOOTSTRAP_ENABLED !== "true") return reply({ error: "UNAVAILABLE" }, 503);

    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if ((origin !== null && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return reply({ error: "FORBIDDEN" }, 403);
    }
    // Only a canonical server ID is accepted. Client roles, user IDs, guild IDs,
    // plan values and duplicate IDs can never become authorization inputs.
    if (url.searchParams.getAll("serverId").length !== 1
      || [...url.searchParams.keys()].some(key => key !== "serverId")) {
      return reply({ error: "INVALID_SERVER_ID" }, 400);
    }
    const serverId = url.searchParams.get("serverId");
    if (!isCanonicalStrongholdServerId(serverId)) return reply({ error: "INVALID_SERVER_ID" }, 400);
    const snapshot = await requireDb(env).prepare(ACCESS_SNAPSHOT_SQL)
      .bind(user.id, serverId).first<StrongholdAccessSnapshot>();
    const now = Date.now();
    if (sessionExpiresAt <= now) return reply({ error: "UNAUTHENTICATED" }, 401);
    const decision = evaluateStrongholdAccess({
      enabled: env.DZN_STRONGHOLD_BOOTSTRAP_ENABLED, user, requestedServerId: serverId, snapshot, now,
    });
    if (!decision.allowed) return reply({ error: decision.code }, decision.status);
    return reply({
      policyVersion: STRONGHOLD_ACCESS_POLICY_VERSION,
      serverTime: now,
      user: { id: decision.userId },
      community: { id: decision.serverId },
      authority: decision.authority,
      membershipVerifiedAt: decision.membershipVerifiedAt,
      validUntil: Math.min(decision.validUntil, sessionExpiresAt),
      readOnly: true,
      gameplayReady: false,
      capabilities: {
        readBootstrap: true,
        play: false,
        contribute: false,
        manageBase: false,
        registerWar: false,
      },
    });
  } catch {
    // Missing schema, database failures and malformed session state fail closed.
    // Do not return SQL, cookies, billing identifiers or exception details.
    return reply({ error: "UNAVAILABLE" }, 503);
  }
}
