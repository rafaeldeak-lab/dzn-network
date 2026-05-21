import { getSessionUser, requireDb } from "../../../../_lib/db";
import { ensureCtfTournamentSchema } from "../../../../_lib/ctf-tournaments";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

type RosterRegistrationBody = {
  tournament_id?: string;
  player_name?: string;
  player_id?: string;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const linkedServerId = sanitizeServerId(params.serverId);
  if (!linkedServerId) return rosterError(400, "invalid_server_id", "Invalid server id.");

  const user = await getSessionUser(env, request);
  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    return rosterError(
      access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403,
      access.reason === "unauthenticated" ? "unauthorized" : access.reason === "not_found" ? "server_not_found" : "forbidden",
      access.reason === "unauthenticated" ? "Unauthorized." : access.reason === "not_found" ? "Server not found." : "Forbidden.",
    );
  }

  await ensureCtfTournamentSchema(env);
  const body = await readJson<RosterRegistrationBody>(request);
  const tournamentId = sanitizeTournamentId(body.tournament_id);
  const playerName = cleanPlayerName(body.player_name);
  const playerId = cleanPlayerId(body.player_id);

  if (!tournamentId) return rosterError(400, "missing_tournament_id", "Tournament id is required.");
  if (!playerName) return rosterError(400, "missing_player_name", "Exact case-sensitive gamertag is required.");
  if (!playerId) return rosterError(400, "missing_player_id", "Unique account GUID hash is required.");

  const db = requireDb(env);
  const participant = await db
    .prepare(
      `SELECT 1 AS ok
       FROM ctf_match_participants
       JOIN ctf_tournaments ON ctf_tournaments.id = ctf_match_participants.ctf_tournament_id
       WHERE ctf_match_participants.ctf_tournament_id = ?
         AND ctf_match_participants.linked_server_id = ?
         AND ctf_tournaments.current_phase IN ('PRE_WAR_ROSTER', 'WAR_PREP_CONFIG', 'BATTLE_ACTIVE')
       LIMIT 1`,
    )
    .bind(tournamentId, linkedServerId)
    .first<{ ok: number }>();

  if (!participant?.ok) {
    return rosterError(409, "registration_closed", "This server is not accepting roster registrations for that tournament.");
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ctf_tournament_rosters (
        ctf_tournament_id, linked_server_id, player_id, player_name, registered_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ctf_tournament_id, linked_server_id, player_id) DO UPDATE SET
        player_name = excluded.player_name,
        registered_at = excluded.registered_at`,
    )
    .bind(tournamentId, linkedServerId, playerId, playerName, now)
    .run();

  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM ctf_tournament_rosters WHERE ctf_tournament_id = ? AND linked_server_id = ?")
    .bind(tournamentId, linkedServerId)
    .first<{ count: number | null }>();

  return json(
    {
      ok: true,
      registered_at: now,
      roster_count: Number(count?.count ?? 0),
      player: {
        player_id: playerId,
        player_name: playerName,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
};

function rosterError(status: number, error: string, message: string) {
  return json({ ok: false, error, message }, { status, headers: { "cache-control": "no-store" } });
}

function sanitizeServerId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{8,80}$/.test(text) ? text : null;
}

function sanitizeTournamentId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_-]{1,80}$/.test(text) ? text : null;
}

function cleanPlayerName(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 2 || text.length > 80) return null;
  return text;
}

function cleanPlayerId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 8 || text.length > 255) return null;
  return text;
}
