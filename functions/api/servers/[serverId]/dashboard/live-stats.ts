import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import { getCanonicalServerRank, getCanonicalServerStats } from "../../../../_lib/server-stats";
import type { PagesFunction } from "../../../../_lib/types";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, no-cache, must-revalidate",
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeId(params.serverId);
    if (!linkedServerId) {
      return liveStatsError(400, "invalid_server_id", "Invalid server id.");
    }

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed) {
      return liveStatsError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const db = requireDb(env);
    const stats = await getCanonicalServerStats(db, linkedServerId);
    const rank = await getCanonicalServerRank(db, linkedServerId, stats);
    const generatedAt = new Date().toISOString();

    return json({
      ok: true,
      server_id: linkedServerId,
      generated_at: generatedAt,
      latest_event_at: stats.lastEventAt,
      source: "canonical-adm-events",
      stats: {
        kills: stats.kills,
        deaths: stats.deaths,
        joins: stats.joins,
        disconnects: stats.disconnects,
        unique_players: stats.uniquePlayers,
        longest_kill: stats.longestKill,
        total_events_tracked: stats.totalEventsTracked,
        score: rank.score,
        score_label: rank.scoreLabel,
        rank: rank.rank,
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return liveStatsError(500, "dashboard_live_stats_failed", "Unable to load live canonical dashboard stats.", sanitize(error));
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, { status: 204, headers: { Allow: "GET, OPTIONS", ...NO_STORE_HEADERS } });

function sanitizeId(value: unknown) {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === "string" && /^[a-zA-Z0-9_-]{3,128}$/.test(id) ? id : null;
}

function liveStatsError(status: number, errorCode: string, message: string, details: unknown = null) {
  return json({
    ok: false,
    error_code: errorCode,
    message,
    details,
    generated_at: new Date().toISOString(),
    source: "error",
  }, { status, headers: NO_STORE_HEADERS });
}

function sanitize(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value.slice(0, 240);
  return null;
}
