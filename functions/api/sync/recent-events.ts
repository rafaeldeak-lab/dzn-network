import { ensureMockUser, getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  try {
    const events = await readRecentAdmSyncEvents(
      env,
      user.id,
      sanitizeLinkedServerId(url.searchParams.get("linked_server_id")),
      sanitizeLimit(url.searchParams.get("limit")),
    );
    return json({ ok: true, events }, { headers: privateRecentEventsHeaders() });
  } catch (error) {
    return json({
      ok: true,
      events: [],
      stale: true,
      warning: error instanceof Error ? error.message : "Recent sync events unavailable",
      reason: "recent_events_temporarily_unavailable",
    }, { headers: privateRecentEventsHeaders() });
  }
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

function sanitizeLimit(value: unknown) {
  const limit = typeof value === "string" ? Number(value) : 8;
  return Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 10) : 8;
}

async function readRecentAdmSyncEvents(
  env: Env,
  userId: string,
  linkedServerId: string | null,
  limit: number,
) {
  const db = requireDb(env);
  const linkedServer = await db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE user_id = ?
         AND (? IS NULL OR id = ?)
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 1`,
    )
    .bind(userId, linkedServerId, linkedServerId)
    .first<{ id: string }>();
  if (!linkedServer) throw new Error("No linked server found");

  const includeMock = isMockNitrado(env.MOCK_NITRADO) ? 1 : 0;
  const result = await db
    .prepare(
      `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at
       FROM (
         SELECT
           'kill' AS source,
           'player_killed' AS event_type,
           NULL AS player_name,
           killer_name,
           victim_name,
           weapon,
           distance,
           occurred_at,
           created_at,
           0 AS event_priority,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM kill_events
         WHERE linked_server_id = ?
           AND (
             ? = 1
             OR (
               COALESCE(killer_name, '') NOT LIKE 'MockSurvivor%'
               AND COALESCE(killer_name, '') NOT LIKE 'MockBandit%'
               AND COALESCE(killer_name, '') NOT LIKE 'MockRunner%'
               AND COALESCE(victim_name, '') NOT LIKE 'MockSurvivor%'
               AND COALESCE(victim_name, '') NOT LIKE 'MockBandit%'
               AND COALESCE(victim_name, '') NOT LIKE 'MockRunner%'
             )
           )

         UNION ALL

         SELECT
           'player' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           CASE
             WHEN event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats') THEN 1
             WHEN event_type IN ('player_connected', 'player_disconnected', 'playerlist_snapshot') THEN 2
             ELSE 3
           END AS event_priority,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM player_events
         WHERE linked_server_id = ?
           AND event_type NOT LIKE 'player_hit%'
           AND (
             ? = 1
             OR (
               COALESCE(player_name, '') NOT LIKE 'MockSurvivor%'
               AND COALESCE(player_name, '') NOT LIKE 'MockBandit%'
               AND COALESCE(player_name, '') NOT LIKE 'MockRunner%'
             )
           )

         UNION ALL

         SELECT
           'build' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           COALESCE(tool, placed_class, build_part) AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           4 AS event_priority,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM build_events
         WHERE linked_server_id = ?
           AND (
             ? = 1
             OR (
               COALESCE(player_name, '') NOT LIKE 'MockSurvivor%'
               AND COALESCE(player_name, '') NOT LIKE 'MockBandit%'
               AND COALESCE(player_name, '') NOT LIKE 'MockRunner%'
             )
           )
       )
       ORDER BY event_priority ASC, sort_time DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(
      linkedServer.id,
      includeMock,
      linkedServer.id,
      includeMock,
      linkedServer.id,
      includeMock,
      limit,
    )
    .all<{
      source: "kill" | "player" | "build";
      event_type: string;
      player_name: string | null;
      killer_name: string | null;
      victim_name: string | null;
      weapon: string | null;
      distance: number | null;
      occurred_at: string | null;
      created_at: string | null;
    }>();

  return result.results ?? [];
}

function privateRecentEventsHeaders() {
  return {
    "cache-control": "private, max-age=10",
  };
}
