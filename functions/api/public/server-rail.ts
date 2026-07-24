import { requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { publicCacheHeaders } from "../../_lib/performance";
import {
  PUBLIC_CURRENT_PLAYERS_SQL,
  PUBLIC_MAX_PLAYERS_SQL,
  PUBLIC_PLAYER_COUNT_STATUS_SQL,
} from "../../_lib/player-counts";
import type { Env, PagesFunction } from "../../_lib/types";
import { normalizeListingPlanKey } from "../../../lib/billing/plans";
import {
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  serverLifecycleInSql,
  serverLifecycleSqlExpression,
} from "../../../lib/server-lifecycle";

type RailRow = {
  id: string;
  public_slug: string | null;
  server_name: string | null;
  server_type: string | null;
  guild_icon_url: string | null;
  current_players: number | null;
  max_players: number | null;
  player_count_status: string | null;
  average_rating: number | null;
  review_count: number | null;
  plan_key: string | null;
  subscription_status: string | null;
  last_bumped_at: string | null;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const headers = publicCacheHeaders({ maxAge: 60, staleWhileRevalidate: 300 });
  headers.set("x-dzn-cache-policy", "s-maxage=60; stale-while-revalidate=300");

  if (!env.DB) {
    return json({ ok: true, items: [], generated_at: new Date().toISOString() }, { headers });
  }

  try {
    const rows = await queryServerRail(env);
    return json({
      ok: true,
      items: rows.map(toRailItem),
      generated_at: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    console.warn("DZN SERVER RAIL FALLBACK", error instanceof Error ? error.message : "unknown error");
    return json({ ok: true, items: [], generated_at: new Date().toISOString(), stale: true }, { headers });
  }
};

async function queryServerRail(env: Env) {
  const db = requireDb(env);
  const lifecycleStatusSql = serverLifecycleSqlExpression("linked_servers");
  const result = await db.prepare(
    `SELECT
       linked_servers.id,
       linked_servers.public_slug,
       COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
       COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
       discord_guilds.icon_url AS guild_icon_url,
       ${PUBLIC_CURRENT_PLAYERS_SQL} AS current_players,
       COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players, linked_servers.player_slots) AS max_players,
       ${PUBLIC_PLAYER_COUNT_STATUS_SQL} AS player_count_status,
       review_summary.average_rating,
       COALESCE(review_summary.review_count, 0) AS review_count,
       COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
       server_subscriptions.status AS subscription_status,
       server_advertising_state.last_bumped_at
     FROM linked_servers
     LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
     LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
     LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
     LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
     LEFT JOIN (
       SELECT linked_server_id,
              ROUND(AVG(rating), 1) AS average_rating,
              COUNT(*) AS review_count
         FROM server_reviews
        WHERE status = 'active'
        GROUP BY linked_server_id
     ) AS review_summary ON review_summary.linked_server_id = linked_servers.id
     WHERE lower(COALESCE(linked_servers.status, '')) = 'live'
       AND ${lifecycleStatusSql} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})
       AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
       AND linked_servers.public_slug IS NOT NULL
       AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
     ORDER BY
       CASE
         WHEN lower(COALESCE(server_subscriptions.status, '')) IN ('active', 'trialing')
          AND lower(COALESCE(server_subscriptions.plan_key, 'free')) NOT IN ('', 'free')
         THEN 0 ELSE 1
       END,
       datetime(COALESCE(server_advertising_state.last_bumped_at, linked_servers.public_listing_updated_at, linked_servers.updated_at, linked_servers.created_at)) DESC,
       linked_servers.id ASC
     LIMIT 24`,
  ).all<RailRow>();
  return result.results ?? [];
}

function toRailItem(row: RailRow) {
  const listingPlanKey = normalizeListingPlanKey(row.plan_key, row.subscription_status);
  return {
    id: row.id,
    slug: row.public_slug,
    name: row.server_name ?? "DZN Server",
    logoUrl: row.guild_icon_url,
    category: row.server_type ?? "DayZ",
    currentPlayers: numberOrNull(row.current_players),
    maxPlayers: numberOrNull(row.max_players),
    playerCountStatus: row.player_count_status ?? "unknown",
    ratingAverage: numberOrNull(row.average_rating),
    reviewCount: Number(row.review_count ?? 0),
    listingPlanKey,
    isPro: listingPlanKey === "pro",
    lastBumpedAt: row.last_bumped_at,
  };
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
