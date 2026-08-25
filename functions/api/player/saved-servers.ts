import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type SavedServerRequestBody = {
  linked_server_id?: unknown;
  public_slug?: unknown;
};

type SavedServerTarget = {
  linkedServerId: string | null;
  publicSlug: string | null;
};

type SavedServerRow = {
  linked_server_id: string;
  public_slug: string | null;
  server_name: string | null;
  saved_at: string | null;
  updated_at: string | null;
  source: string | null;
};

const BODY_LIMIT_BYTES = 2048;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (!["GET", "POST", "DELETE"].includes(request.method)) return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  if (request.method === "GET") return listSavedServers(env, user);
  if (!env.DB) return savedServersUnavailable();

  const targetResult = await readSavedServerTarget(request);
  if (!targetResult.ok) {
    return json({ ok: false, error: targetResult.error, message: targetResult.message }, { status: targetResult.status });
  }

  let server: SavedServerRow | null = null;
  try {
    server = await resolvePublicServer(env, targetResult.target);
  } catch {
    return savedServersUnavailable();
  }
  if (!server) {
    return json({
      ok: false,
      error: "PUBLIC_SERVER_NOT_FOUND",
      message: "That public DZN server could not be found.",
    }, { status: 404 });
  }

  if (request.method === "POST") return saveServer(env, user, server);
  return deleteSavedServer(env, user, server);
};

async function listSavedServers(env: Env, user: SessionUser) {
  if (!env.DB) return savedServerList("unavailable", []);

  try {
    const rows = await env.DB
      .prepare(
        `SELECT
           player_saved_servers.created_at AS saved_at,
           player_saved_servers.updated_at,
           player_saved_servers.source,
           linked_servers.id AS linked_server_id,
           linked_servers.public_slug,
           COALESCE(
             linked_servers.display_name,
             linked_servers.hostname,
             linked_servers.server_name,
             linked_servers.nitrado_service_name,
             'DZN Server'
           ) AS server_name
         FROM player_saved_servers
         INNER JOIN linked_servers ON linked_servers.id = player_saved_servers.linked_server_id
         WHERE player_saved_servers.user_id = ?
           AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
           AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
           AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         ORDER BY datetime(COALESCE(player_saved_servers.updated_at, player_saved_servers.created_at)) DESC
         LIMIT 100`,
      )
      .bind(user.id)
      .all<SavedServerRow>();

    return savedServerList("saved", rows.results ?? []);
  } catch {
    return savedServerList("not_configured", []);
  }
}

async function saveServer(env: Env, user: SessionUser, server: SavedServerRow) {
  const now = new Date().toISOString();
  try {
    await env.DB
      .prepare(
        `INSERT INTO player_saved_servers (id, user_id, linked_server_id, source, created_at, updated_at)
         VALUES (?, ?, ?, 'manual', ?, ?)
         ON CONFLICT(user_id, linked_server_id) DO UPDATE SET
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .bind(randomPreferenceId(), user.id, server.linked_server_id, now, now)
      .run();
  } catch {
    return savedServersUnavailable();
  }

  return json({
    ok: true,
    saved: true,
    linked_server_id: server.linked_server_id,
    public_slug: server.public_slug,
    server_name: server.server_name ?? "DZN Server",
    saved_at: now,
  });
}

async function deleteSavedServer(env: Env, user: SessionUser, server: SavedServerRow) {
  try {
    await env.DB
      .prepare(
        `DELETE FROM player_saved_servers
         WHERE user_id = ?
           AND linked_server_id = ?`,
      )
      .bind(user.id, server.linked_server_id)
      .run();
  } catch {
    return savedServersUnavailable();
  }

  return json({
    ok: true,
    saved: false,
    linked_server_id: server.linked_server_id,
    public_slug: server.public_slug,
  });
}

async function resolvePublicServer(env: Env, target: SavedServerTarget): Promise<SavedServerRow | null> {
  if (!env.DB) return null;

  const clauses: string[] = [];
  const values: string[] = [];
  if (target.linkedServerId) {
    clauses.push("linked_servers.id = ?");
    values.push(target.linkedServerId);
  }
  if (target.publicSlug) {
    clauses.push("lower(linked_servers.public_slug) = lower(?)");
    values.push(target.publicSlug);
  }
  if (!clauses.length) return null;

  return env.DB
    .prepare(
      `SELECT
         linked_servers.id AS linked_server_id,
         linked_servers.public_slug,
         COALESCE(
           linked_servers.display_name,
           linked_servers.hostname,
           linked_servers.server_name,
           linked_servers.nitrado_service_name,
           'DZN Server'
         ) AS server_name,
         NULL AS saved_at,
         NULL AS updated_at,
         'manual' AS source
       FROM linked_servers
       WHERE (${clauses.join(" OR ")})
         AND COALESCE(linked_servers.public_slug, '') != ''
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
       LIMIT 1`,
    )
    .bind(...values)
    .first<SavedServerRow>();
}

async function readSavedServerTarget(request: Request): Promise<
  | { ok: true; target: SavedServerTarget }
  | { ok: false; status: 400 | 413; error: string; message: string }
> {
  const url = new URL(request.url);
  const bounded = await readBoundedJson<SavedServerRequestBody>(request, BODY_LIMIT_BYTES);
  if (!bounded.ok) return bounded;

  const target = {
    linkedServerId: cleanInput(bounded.value.linked_server_id) ?? cleanInput(url.searchParams.get("linked_server_id")),
    publicSlug: cleanInput(bounded.value.public_slug) ?? cleanInput(url.searchParams.get("public_slug")),
  };

  if (!target.linkedServerId && !target.publicSlug) {
    return {
      ok: false,
      status: 400,
      error: "SAVED_SERVER_TARGET_REQUIRED",
      message: "Choose a public DZN server to save.",
    };
  }

  return { ok: true, target };
}

function savedServerList(source: "saved" | "not_configured" | "unavailable", rows: SavedServerRow[]) {
  return json({
    ok: true,
    source,
    saved_servers: rows.map((row) => ({
      linked_server_id: row.linked_server_id,
      public_slug: row.public_slug,
      server_name: row.server_name ?? "DZN Server",
      saved_at: row.saved_at,
      updated_at: row.updated_at,
      source: row.source ?? "manual",
    })),
    saved_server_ids: rows.map((row) => row.linked_server_id),
    saved_server_slugs: rows.map((row) => row.public_slug).filter((slug): slug is string => Boolean(slug)),
  });
}

function savedServersUnavailable() {
  return json({
    ok: false,
    error: "PLAYER_SAVED_SERVERS_UNAVAILABLE",
    message: "Saved server preferences could not be updated right now.",
  }, { status: 503 });
}

function cleanInput(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return null;
  return trimmed;
}

function randomPreferenceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `saved_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
