import { normalizeListingPlanKey } from "../../lib/billing/plans";
import type { SessionUser } from "./types";

// A NEW, default-off bootstrap policy. Existing presentation-only membership
// readers and free Games Hub / personal Command Centre contracts are unchanged.
export const STRONGHOLD_ACCESS_POLICY_VERSION = "stronghold-bootstrap-v1";
export const STRONGHOLD_MEMBERSHIP_MAX_AGE_MS = 15 * 60_000;

export type StrongholdAccessSnapshot = {
  server_id: string;
  owner_user_id: string;
  owner_discord_id: string;
  guild_id: string;
  server_status: string | null;
  lifecycle_status: string | null;
  merged_into_server_id: string | null;
  billing_owner_discord_id: string | null;
  owner_plan_key: string | null;
  owner_plan_status: string | null;
  owner_customer_id: string | null;
  owner_subscription_id: string | null;
  owner_period_start: string | null;
  owner_period_end: string | null;
  subscription_guild_id: string | null;
  subscription_owner_discord_id: string | null;
  server_plan_key: string | null;
  server_plan_status: string | null;
  server_customer_id: string | null;
  server_subscription_id: string | null;
  server_period_start: string | null;
  server_period_end: string | null;
  membership_user_id: string | null;
  membership_guild_id: string | null;
  membership_source: string | null;
  membership_last_seen_at: string | null;
  membership_revoked_at: string | null;
};

export type StrongholdAccessDenialCode =
  | "UNAUTHENTICATED"
  | "UNAVAILABLE"
  | "INVALID_SERVER_ID"
  | "SERVER_NOT_FOUND"
  | "SERVER_UNAVAILABLE"
  | "MEMBERSHIP_REQUIRED"
  | "MEMBERSHIP_REFRESH_REQUIRED"
  | "COVERED_PRO_REQUIRED";

export type StrongholdAccessDecision =
  | { allowed: false; status: 400 | 401 | 403 | 404 | 503; code: StrongholdAccessDenialCode }
  | {
      allowed: true;
      serverId: string;
      userId: string;
      authority: "owner" | "member";
      membershipVerifiedAt: number;
      validUntil: number;
    };

export function isCanonicalStrongholdServerId(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}

function deny(status: 400 | 401 | 403 | 404 | 503, code: StrongholdAccessDenialCode): StrongholdAccessDecision {
  return { allowed: false, status, code };
}

// D1 CURRENT_TIMESTAMP uses a UTC space-separated value. Billing projections
// use ISO UTC. Reject ambiguous local dates, invalid dates and unknown formats.
function utcTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) iso = value.replace(" ", "T") + "Z";
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) iso = value;
  else return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
  return parsed;
}

function activePaidPeriod(plan: string | null, status: string | null, start: string | null, end: string | null, now: number) {
  // This narrow foundation requires active paid access. Trialing and showcase
  // exceptions are deliberately not silently imported into Stronghold.
  if (status !== "active" || normalizeListingPlanKey(plan, status) !== "pro") return null;
  const startsAt = utcTimestamp(start);
  const endsAt = utcTimestamp(end);
  return startsAt !== null && endsAt !== null && startsAt <= now && now < endsAt ? endsAt : null;
}

export function evaluateStrongholdAccess(input: {
  enabled: unknown;
  user: Pick<SessionUser, "id" | "discord_id"> | null;
  requestedServerId: unknown;
  snapshot: StrongholdAccessSnapshot | null;
  now: number;
}): StrongholdAccessDecision {
  const { user, snapshot: row, now } = input;
  if (!user) return deny(401, "UNAUTHENTICATED");
  if (input.enabled !== "true" || !Number.isSafeInteger(now) || now <= 0) return deny(503, "UNAVAILABLE");
  if (!isCanonicalStrongholdServerId(input.requestedServerId)) return deny(400, "INVALID_SERVER_ID");
  if (!row || row.server_id !== input.requestedServerId || !row.owner_user_id || !row.owner_discord_id || !row.guild_id) {
    return deny(404, "SERVER_NOT_FOUND");
  }
  if (row.server_status !== "live" || row.lifecycle_status !== "active_live" || row.merged_into_server_id) {
    return deny(403, "SERVER_UNAVAILABLE");
  }
  // Read membership for this authenticated DZN user and this exact server's
  // Discord guild. Public directory labels and manageable-guild caches are not
  // considered. Owners also need current membership evidence; no owner bypass.
  if (row.membership_user_id !== user.id || row.membership_guild_id !== row.guild_id
    || row.membership_source !== "discord_oauth_guilds" || row.membership_revoked_at !== null) {
    return deny(403, "MEMBERSHIP_REQUIRED");
  }
  const lastSeenAt = utcTimestamp(row.membership_last_seen_at);
  if (lastSeenAt === null || lastSeenAt > now || now - lastSeenAt >= STRONGHOLD_MEMBERSHIP_MAX_AGE_MS) {
    return deny(403, "MEMBERSHIP_REFRESH_REQUIRED");
  }
  const ownerEndsAt = activePaidPeriod(row.owner_plan_key, row.owner_plan_status, row.owner_period_start, row.owner_period_end, now);
  const serverEndsAt = activePaidPeriod(row.server_plan_key, row.server_plan_status, row.server_period_start, row.server_period_end, now);
  if (row.billing_owner_discord_id !== row.owner_discord_id
    || row.subscription_owner_discord_id !== row.owner_discord_id
    || row.subscription_guild_id !== row.guild_id
    || !/^cus_[A-Za-z0-9_]+$/.test(row.owner_customer_id ?? "")
    || !/^sub_[A-Za-z0-9_]+$/.test(row.owner_subscription_id ?? "")
    || row.owner_customer_id !== row.server_customer_id
    || row.owner_subscription_id !== row.server_subscription_id
    || ownerEndsAt === null || serverEndsAt === null) {
    return deny(403, "COVERED_PRO_REQUIRED");
  }
  return {
    allowed: true,
    serverId: row.server_id,
    userId: user.id,
    authority: row.owner_user_id === user.id ? "owner" : "member",
    membershipVerifiedAt: lastSeenAt,
    validUntil: Math.min(lastSeenAt + STRONGHOLD_MEMBERSHIP_MAX_AGE_MS, ownerEndsAt, serverEndsAt),
  };
}
