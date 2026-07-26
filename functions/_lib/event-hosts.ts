import { requireDb } from "./db";
import { normalizePlanKey, type PlanKey } from "./plans";
import type { Env, SessionUser } from "./types";

const EVENT_HOST_PLANS: PlanKey[] = ["pro", "premium", "network", "partner"];
const EVENT_HOST_ACTIVE_STATUSES = ["active", "trialing"] as const;

const EVENT_HOST_SELECT_COLUMNS = `
  linked_servers.id,
  linked_servers.user_id,
  linked_servers.guild_id,
  linked_servers.public_slug,
  linked_servers.display_name,
  linked_servers.hostname,
  linked_servers.server_name,
  linked_servers.nitrado_service_name,
  linked_servers.server_type,
  linked_servers.server_mode,
  linked_servers.server_category,
  linked_servers.competitive_enabled,
  linked_servers.verified_server,
  linked_servers.event_mmr,
  linked_servers.season_points,
  linked_servers.event_wins,
  linked_servers.event_losses,
  linked_servers.event_draws,
  linked_servers.last_event_at,
  linked_servers.current_players,
  linked_servers.max_players,
  linked_servers.status,
  linked_servers.listing_visibility,
  linked_servers.merged_into_server_id,
  linked_servers.updated_at,
  (
    SELECT COUNT(*)
    FROM server_subscriptions
    WHERE server_subscriptions.guild_id = linked_servers.guild_id
  ) AS subscription_row_count,
  (
    SELECT COUNT(*)
    FROM server_subscriptions
    WHERE server_subscriptions.guild_id = linked_servers.guild_id
      AND lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')
      AND lower(COALESCE(server_subscriptions.plan_key, 'free')) IN ('pro', 'premium', 'network', 'partner')
  ) AS eligible_subscription_count,
  (
    SELECT server_subscriptions.plan_key
    FROM server_subscriptions
    WHERE server_subscriptions.guild_id = linked_servers.guild_id
    LIMIT 1
  ) AS plan_key,
  (
    SELECT server_subscriptions.status
    FROM server_subscriptions
    WHERE server_subscriptions.guild_id = linked_servers.guild_id
    LIMIT 1
  ) AS subscription_status
`;

export const EVENT_CREATE_HOST_TRANSACTION_PREDICATE = `
  linked_servers.id = ?
  AND linked_servers.user_id = ?
  AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'archived')
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (
    SELECT COUNT(*)
    FROM server_subscriptions
    WHERE server_subscriptions.guild_id = linked_servers.guild_id
  ) = 1
  AND (
    SELECT COUNT(*)
    FROM server_subscriptions
    WHERE server_subscriptions.guild_id = linked_servers.guild_id
      AND lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')
      AND lower(COALESCE(server_subscriptions.plan_key, 'free')) IN ('pro', 'premium', 'network', 'partner')
  ) = 1
`;

export type AuthorizedEventCreationHost = {
  id: string;
  user_id: string | null;
  guild_id: string | null;
  public_slug: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  server_type: string | null;
  server_mode: string | null;
  server_category: string | null;
  competitive_enabled: number | null;
  verified_server: number | null;
  event_mmr: number | null;
  season_points: number | null;
  event_wins: number | null;
  event_losses: number | null;
  event_draws: number | null;
  last_event_at: string | null;
  current_players: number | null;
  max_players: number | null;
  status: string | null;
  listing_visibility: string | null;
  merged_into_server_id: string | null;
  updated_at: string | null;
  subscription_row_count: number | null;
  eligible_subscription_count: number | null;
  plan_key: string | null;
  subscription_status: string | null;
};

export type EventCreationHostResolution =
  | { ok: true; server: AuthorizedEventCreationHost }
  | { ok: false; status: 403 | 404 | 409; error: string; message: string };

export async function listAuthorizedEventCreationHosts(env: Env, viewer: SessionUser): Promise<AuthorizedEventCreationHost[]> {
  const result = await requireDb(env)
    .prepare(
      `SELECT ${EVENT_HOST_SELECT_COLUMNS}
       FROM linked_servers
       WHERE linked_servers.user_id = ?
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'archived')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (
           SELECT COUNT(*)
           FROM server_subscriptions
           WHERE server_subscriptions.guild_id = linked_servers.guild_id
         ) = 1
         AND (
           SELECT COUNT(*)
           FROM server_subscriptions
           WHERE server_subscriptions.guild_id = linked_servers.guild_id
             AND lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')
             AND lower(COALESCE(server_subscriptions.plan_key, 'free')) IN ('pro', 'premium', 'network', 'partner')
         ) = 1
       ORDER BY lower(COALESCE(linked_servers.display_name, linked_servers.server_name, linked_servers.hostname, linked_servers.id)) ASC
       LIMIT 100`,
    )
    .bind(viewer.id)
    .all<AuthorizedEventCreationHost>();
  return result.results ?? [];
}

export async function resolveAuthorizedEventCreationHost(
  env: Env,
  viewer: SessionUser,
  serverId: unknown,
): Promise<EventCreationHostResolution> {
  const cleanId = cleanEventHostId(serverId);
  if (!cleanId) return serverNotFoundPayload();

  const result = await requireDb(env)
    .prepare(
      `SELECT ${EVENT_HOST_SELECT_COLUMNS}
       FROM linked_servers
       WHERE linked_servers.id = ?
         AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(cleanId, viewer.id)
    .all<AuthorizedEventCreationHost>();
  const rows = result.results ?? [];
  if (rows.length === 0) return serverNotFoundPayload();

  const server = rows[0];
  const status = lowerText(server.status, "pending");
  const visibility = lowerText(server.listing_visibility, "public");
  const mergedInto = String(server.merged_into_server_id ?? "").trim();
  if (status === "deleted") return serverNotFoundPayload();
  if (status === "archived" || status === "merged" || mergedInto || visibility === "hidden") {
    return invalidHostStatePayload();
  }

  const subscriptionRows = Number(server.subscription_row_count ?? 0);
  const eligibleSubscriptions = Number(server.eligible_subscription_count ?? 0);
  if (subscriptionRows > 1) return invalidHostStatePayload();
  if (subscriptionRows !== 1 || eligibleSubscriptions !== 1 || !hasEventHostEntitlement(server)) {
    return planLockedPayload();
  }

  return { ok: true, server };
}

function cleanEventHostId(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{3,96}$/.test(text) ? text : null;
}

function lowerText(value: unknown, fallback: string) {
  const text = String(value ?? fallback).trim().toLowerCase();
  return text || fallback;
}

function hasEventHostEntitlement(server: Pick<AuthorizedEventCreationHost, "plan_key" | "subscription_status">) {
  const status = lowerText(server.subscription_status, "");
  return EVENT_HOST_ACTIVE_STATUSES.includes(status as (typeof EVENT_HOST_ACTIVE_STATUSES)[number]) && EVENT_HOST_PLANS.includes(normalizePlanKey(server.plan_key));
}

function serverNotFoundPayload() {
  return { ok: false as const, status: 404 as const, error: "SERVER_NOT_FOUND", message: "Hosting server not found." };
}

function invalidHostStatePayload() {
  return {
    ok: false as const,
    status: 409 as const,
    error: "INVALID_HOST_STATE",
    message: "Hosting server is not eligible for official event creation.",
  };
}

function planLockedPayload() {
  return { ok: false as const, status: 403 as const, error: "PLAN_LOCKED", message: "Event creation is a Pro or Premium feature." };
}
