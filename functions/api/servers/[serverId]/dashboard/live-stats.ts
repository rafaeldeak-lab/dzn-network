import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import { calculateServerScoreBreakdown } from "../../../../_lib/server-ranking";
import { getCanonicalServerLiveStats } from "../../../../_lib/server-stats";
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
    const server = access.server;
    if (!server) {
      return liveStatsError(403, "forbidden", "Forbidden.");
    }

    const db = requireDb(env);
    const stats = await getCanonicalServerLiveStats(db, linkedServerId);
    const scoreBreakdown = calculateServerScoreBreakdown({
      kills: stats.kills,
      deaths: stats.deaths,
      joins: stats.joins,
      uniquePlayers: stats.uniquePlayers,
      longestKill: stats.longestKill,
      statsSyncActive: stats.statsSyncActive,
    });
    const rank = await readLightweightRank(db, server.guild_id);
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
        score: scoreBreakdown.final_score,
        score_label: String(scoreBreakdown.final_score),
        rank: rank.rank,
      },
      rank_source: rank.source,
      rank_generated_at: rank.generatedAt,
      rank_stale: rank.stale,
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

async function readLightweightRank(db: D1Database, guildId: string | null) {
  if (!guildId) return unavailableRank();

  try {
    const row = await db
      .prepare(
        `SELECT network_rank, last_adm_update_at, updated_at
         FROM server_public_cache
         WHERE guild_id = ?
         LIMIT 1`,
      )
      .bind(guildId)
      .first<{ network_rank: number | null; last_adm_update_at: string | null; updated_at: string | null }>();

    const rank = Number(row?.network_rank ?? 0);
    if (!Number.isFinite(rank) || rank <= 0) return unavailableRank();

    return {
      rank,
      source: "leaderboard_snapshot" as const,
      generatedAt: row?.last_adm_update_at ?? row?.updated_at ?? null,
      stale: false,
    };
  } catch {
    return unavailableRank();
  }
}

function unavailableRank() {
  return {
    rank: null,
    source: "unavailable" as const,
    generatedAt: null,
    stale: true,
  };
}
