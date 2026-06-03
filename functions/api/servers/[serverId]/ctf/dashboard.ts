import { getSessionUser, requireDb } from "../../../../_lib/db";
import { ensureCtfTournamentSchema } from "../../../../_lib/ctf-tournaments";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { normalizePlanKey } from "../../../../_lib/plans";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

type ServerRow = {
  id: string;
  guild_id: string | null;
  public_slug: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  server_type: string | null;
  server_mode: string | null;
  platform: string | null;
  map_name: string | null;
  dynamic_visibility_score: number | null;
  plan_key: string | null;
  subscription_status: string | null;
};

type TournamentRow = {
  id: string;
  tournament_name: string;
  current_phase: string;
  phase_ends_at: string;
  target_metric: string;
  target_flag_points: number | null;
  broadcast_interval_minutes: number | null;
  grace_period_config: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ParticipantRow = {
  ctf_tournament_id: string;
  linked_server_id: string;
  accumulated_points: number | null;
  has_raised_flag: number | null;
  last_broadcasted_at: string | null;
  updated_at: string | null;
  public_slug: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  server_type: string | null;
  server_mode: string | null;
  platform: string | null;
  map_name: string | null;
  dynamic_visibility_score: number | null;
  roster_count: number | null;
};

type RosterRow = {
  linked_server_id: string;
  player_id: string;
  player_name: string;
  registered_at: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
};

type FeedRow = {
  id: string;
  linked_server_id: string;
  event_hash: string;
  event_type: string;
  player_id: string | null;
  player_name: string | null;
  point_delta: number | null;
  accepted: number | null;
  rejected_reason: string | null;
  created_at: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const linkedServerId = sanitizeServerId(params.serverId);
  if (!linkedServerId) return ctfError(400, "invalid_server_id", "Invalid server id.");

  const user = await getSessionUser(env, request);
  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    return ctfError(
      access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403,
      access.reason === "unauthenticated" ? "unauthorized" : access.reason === "not_found" ? "server_not_found" : "forbidden",
      access.reason === "unauthenticated" ? "Unauthorized." : access.reason === "not_found" ? "Server not found." : "Forbidden.",
    );
  }

  await ensureCtfTournamentSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();

  const server = await db
    .prepare(
      `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
              linked_servers.display_name, linked_servers.hostname, linked_servers.server_name,
              linked_servers.nitrado_service_name, linked_servers.server_type, linked_servers.server_mode,
              linked_servers.platform, linked_servers.map_name, linked_servers.dynamic_visibility_score,
              server_subscriptions.plan_key, server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<ServerRow>();

  if (!server) return ctfError(404, "server_not_found", "Server not found.");

  const activeTournament = await db
    .prepare(
      `SELECT ctf_tournaments.*
       FROM ctf_tournaments
       JOIN ctf_match_participants ON ctf_match_participants.ctf_tournament_id = ctf_tournaments.id
       WHERE ctf_match_participants.linked_server_id = ?
         AND ctf_tournaments.current_phase IN ('PRE_WAR_ROSTER', 'WAR_PREP_CONFIG', 'BATTLE_ACTIVE')
       ORDER BY CASE ctf_tournaments.current_phase
         WHEN 'BATTLE_ACTIVE' THEN 0
         WHEN 'PRE_WAR_ROSTER' THEN 1
         ELSE 2
       END, ctf_tournaments.phase_ends_at ASC
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<TournamentRow>();

  const [participants, roster, feed, completedMatches] = await Promise.all([
    activeTournament ? fetchParticipants(db, activeTournament.id, activeTournament) : Promise.resolve([]),
    activeTournament ? fetchRoster(db, activeTournament.id) : Promise.resolve([]),
    activeTournament ? fetchVerifiedFeed(db, activeTournament.id) : Promise.resolve([]),
    fetchCompletedMatches(db, linkedServerId),
  ]);

  const planKey = normalizePlanKey(server.plan_key);
  const subscriptionStatus = cleanStatus(server.subscription_status);
  const canUseCrossServerMatching = isActiveSubscription(subscriptionStatus) && (planKey === "pro" || planKey === "premium" || planKey === "network" || planKey === "partner");

  return json(
    {
      ok: true,
      generated_at: now,
      source: "ctf_cached_aggregate",
      data: {
        server: normalizeServer(server),
        subscription: {
          plan_key: planKey,
          status: subscriptionStatus,
          can_use_cross_server_matching: canUseCrossServerMatching,
          required_plans: ["PRO", "DZN_PARTNER"],
        },
        active_tournament: activeTournament ? normalizeTournament(activeTournament) : null,
        participants,
        roster,
        verified_feed: feed,
        completed_matches: completedMatches,
        safeguards: {
          aggregate_source: "ctf_match_participants",
          roster_source: "ctf_tournament_rosters",
          feed_source: "ctf_event_audit.accepted",
          parser_dropout_protected: true,
        },
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
};

async function fetchParticipants(db: D1Database, tournamentId: string, tournament: TournamentRow) {
  const rows = await db
    .prepare(
      `SELECT ctf_match_participants.ctf_tournament_id, ctf_match_participants.linked_server_id,
              ctf_match_participants.accumulated_points, ctf_match_participants.has_raised_flag,
              ctf_match_participants.last_broadcasted_at, ctf_match_participants.updated_at,
              linked_servers.public_slug, linked_servers.display_name, linked_servers.hostname,
              linked_servers.server_name, linked_servers.nitrado_service_name,
              linked_servers.server_type, linked_servers.server_mode, linked_servers.platform,
              linked_servers.map_name, linked_servers.dynamic_visibility_score,
              COUNT(ctf_tournament_rosters.player_id) AS roster_count
       FROM ctf_match_participants
       JOIN linked_servers ON linked_servers.id = ctf_match_participants.linked_server_id
       LEFT JOIN ctf_tournament_rosters
         ON ctf_tournament_rosters.ctf_tournament_id = ctf_match_participants.ctf_tournament_id
        AND ctf_tournament_rosters.linked_server_id = ctf_match_participants.linked_server_id
       WHERE ctf_match_participants.ctf_tournament_id = ?
       GROUP BY ctf_match_participants.ctf_tournament_id, ctf_match_participants.linked_server_id
       ORDER BY ctf_match_participants.accumulated_points DESC, linked_servers.server_name ASC`,
    )
    .bind(tournamentId)
    .all<ParticipantRow>();

  return (rows.results ?? []).map((row) => normalizeParticipant(row, tournament));
}

async function fetchRoster(db: D1Database, tournamentId: string) {
  const rows = await db
    .prepare(
      `SELECT ctf_tournament_rosters.linked_server_id, ctf_tournament_rosters.player_id,
              ctf_tournament_rosters.player_name, ctf_tournament_rosters.registered_at,
              linked_servers.display_name, linked_servers.hostname, linked_servers.server_name,
              linked_servers.nitrado_service_name
       FROM ctf_tournament_rosters
       JOIN linked_servers ON linked_servers.id = ctf_tournament_rosters.linked_server_id
       WHERE ctf_tournament_rosters.ctf_tournament_id = ?
       ORDER BY ctf_tournament_rosters.registered_at DESC, ctf_tournament_rosters.player_name ASC
       LIMIT 200`,
    )
    .bind(tournamentId)
    .all<RosterRow>();
  return (rows.results ?? []).map((row) => ({
    linked_server_id: row.linked_server_id,
    server_name: displayName(row),
    player_id: row.player_id,
    player_name: row.player_name,
    registered_at: row.registered_at,
  }));
}

async function fetchVerifiedFeed(db: D1Database, tournamentId: string) {
  const rows = await db
    .prepare(
      `SELECT ctf_event_audit.id, ctf_event_audit.linked_server_id,
              ctf_event_audit.event_hash, ctf_event_audit.event_type,
              ctf_event_audit.player_id, ctf_tournament_rosters.player_name,
              ctf_event_audit.point_delta, ctf_event_audit.accepted,
              ctf_event_audit.rejected_reason, ctf_event_audit.created_at,
              linked_servers.display_name, linked_servers.hostname, linked_servers.server_name,
              linked_servers.nitrado_service_name
       FROM ctf_event_audit
       JOIN linked_servers ON linked_servers.id = ctf_event_audit.linked_server_id
       LEFT JOIN ctf_tournament_rosters
         ON ctf_tournament_rosters.ctf_tournament_id = ctf_event_audit.ctf_tournament_id
        AND ctf_tournament_rosters.linked_server_id = ctf_event_audit.linked_server_id
        AND ctf_tournament_rosters.player_id = ctf_event_audit.player_id
       WHERE ctf_event_audit.ctf_tournament_id = ?
         AND ctf_event_audit.accepted = 1
       ORDER BY ctf_event_audit.created_at DESC
       LIMIT 50`,
    )
    .bind(tournamentId)
    .all<FeedRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    linked_server_id: row.linked_server_id,
    server_name: displayName(row),
    event_hash: row.event_hash,
    event_type: row.event_type,
    player_id: row.player_id,
    player_name: row.player_name ?? shortId(row.player_id),
    point_delta: numberOrZero(row.point_delta),
    accepted: Boolean(row.accepted),
    rejected_reason: row.rejected_reason,
    created_at: row.created_at,
  }));
}

async function fetchCompletedMatches(db: D1Database, linkedServerId: string) {
  const matches = await db
    .prepare(
      `SELECT ctf_tournaments.*
       FROM ctf_tournaments
       JOIN ctf_match_participants ON ctf_match_participants.ctf_tournament_id = ctf_tournaments.id
       WHERE ctf_match_participants.linked_server_id = ?
         AND ctf_tournaments.current_phase = 'CONCLUDED'
       ORDER BY ctf_tournaments.phase_ends_at DESC
       LIMIT 8`,
    )
    .bind(linkedServerId)
    .all<TournamentRow>();
  const tournaments = matches.results ?? [];
  if (!tournaments.length) return [];

  const completed = [];
  for (const tournament of tournaments) {
    const participants = await fetchParticipants(db, tournament.id, tournament);
    const winner = participants.find((item) => item.has_raised_flag) ?? [...participants].sort((a, b) => b.accumulated_points - a.accumulated_points)[0] ?? null;
    completed.push({
      ...normalizeTournament(tournament),
      participants,
      winner,
    });
  }
  return completed;
}

function normalizeServer(row: ServerRow) {
  return {
    id: row.id,
    guild_id: row.guild_id,
    public_slug: row.public_slug,
    server_name: displayName(row),
    server_type: cleanText(row.server_mode) ?? cleanText(row.server_type) ?? "UNKNOWN",
    platform: cleanText(row.platform),
    map_name: cleanText(row.map_name),
    dynamic_visibility_score: numberOrZero(row.dynamic_visibility_score),
  };
}

function normalizeTournament(row: TournamentRow) {
  return {
    id: row.id,
    tournament_name: row.tournament_name,
    current_phase: normalizePhase(row.current_phase),
    phase_ends_at: row.phase_ends_at,
    target_metric: normalizeMetric(row.target_metric),
    target_flag_points: targetPoints(row.target_flag_points),
    broadcast_interval_minutes: numberOrZero(row.broadcast_interval_minutes),
    grace_period_config: safeJson(row.grace_period_config),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeParticipant(row: ParticipantRow, tournament: TournamentRow) {
  const points = numberOrZero(row.accumulated_points);
  const target = targetPoints(tournament.target_flag_points);
  return {
    ctf_tournament_id: row.ctf_tournament_id,
    linked_server_id: row.linked_server_id,
    server_name: displayName(row),
    public_slug: row.public_slug,
    server_type: cleanText(row.server_mode) ?? cleanText(row.server_type) ?? "UNKNOWN",
    platform: cleanText(row.platform),
    map_name: cleanText(row.map_name),
    accumulated_points: points,
    target_points: target,
    progress_percent: progressPercent(points, target),
    has_raised_flag: Boolean(row.has_raised_flag),
    roster_count: numberOrZero(row.roster_count),
    last_broadcasted_at: row.last_broadcasted_at,
    updated_at: row.updated_at,
    dynamic_visibility_score: numberOrZero(row.dynamic_visibility_score),
    status_marker: normalizePhase(tournament.current_phase),
  };
}

function ctfError(status: number, error: string, message: string) {
  return json({ ok: false, error, message }, { status, headers: { "cache-control": "no-store" } });
}

function sanitizeServerId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{8,80}$/.test(text) ? text : null;
}

function displayName(row: { display_name?: string | null; hostname?: string | null; server_name?: string | null; nitrado_service_name?: string | null }) {
  return cleanText(row.display_name) ?? cleanText(row.hostname) ?? cleanText(row.server_name) ?? cleanText(row.nitrado_service_name) ?? "DZN Server";
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function cleanStatus(value: unknown) {
  return cleanText(value)?.toLowerCase() ?? "inactive";
}

function numberOrZero(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function targetPoints(value: unknown) {
  const numberValue = numberOrZero(value);
  return [500, 1000, 2500].includes(numberValue) ? numberValue : numberValue > 0 ? numberValue : 1000;
}

function progressPercent(points: number, target: number) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((points / target) * 1000) / 10));
}

function normalizeMetric(value: unknown) {
  const text = cleanText(value)?.toUpperCase();
  return text === "BUILDING" ? "BUILDING" : "KILLS";
}

function normalizePhase(value: unknown) {
  const text = cleanText(value)?.toUpperCase();
  if (text === "BATTLE_ACTIVE" || text === "PRE_WAR_ROSTER" || text === "WAR_PREP_CONFIG" || text === "CONCLUDED") return text;
  return "PRE_WAR_ROSTER";
}

function safeJson(value: unknown) {
  const text = cleanText(value);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function shortId(value: unknown) {
  const text = cleanText(value);
  return text ? `${text.slice(0, 8)}...` : "Verified player";
}

function isActiveSubscription(value: string) {
  return value === "active" || value === "trialing";
}
