import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import {
  deletePlayerSavedServer,
  readPlayerSavedServersForUser,
  sanitizePlayerSavedServerId,
  sanitizePlayerSavedServerIds,
  savePlayerServer,
} from "../../_lib/player-saved-servers";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type SavedServerBody = {
  linked_server_id?: unknown;
  server_id?: unknown;
};

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, no-cache, must-revalidate",
  vary: "Cookie",
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method === "GET") return handleGet(request, env);
  if (request.method === "POST") return handlePost(request, env);
  if (request.method === "DELETE") return handleDelete(request, env);
  return methodNotAllowed();
};

async function handleGet(request: Request, env: Env) {
  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Log in with Discord to view saved servers." }, { status: 401, headers: PRIVATE_HEADERS });

  const url = new URL(request.url);
  const requestedIdsParam = url.searchParams.get("server_ids");
  const requestedIds = requestedIdsParam === null ? [] : sanitizePlayerSavedServerIds(requestedIdsParam.split(","));
  if (requestedIdsParam !== null && !requestedIds.length) {
    return json({ ok: true, saved_server_ids: [], saved_servers: [] }, { headers: PRIVATE_HEADERS });
  }
  const saved = await readPlayerSavedServersForUser(env, user.id, requestedIds);

  return json({
    ok: true,
    saved_server_ids: saved.savedServerIds,
    saved_servers: saved.savedServers,
  }, { headers: PRIVATE_HEADERS });
}

async function handlePost(request: Request, env: Env) {
  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Log in with Discord to save servers." }, { status: 401, headers: PRIVATE_HEADERS });
  if (!isSameOriginMutation(request)) return json({ error: "Cross-origin saved server updates are not allowed." }, { status: 403, headers: PRIVATE_HEADERS });

  const bodyResult = await readBoundedJson<SavedServerBody>(request, 2048);
  if (!bodyResult.ok) return json({ error: bodyResult.message, code: bodyResult.error }, { status: bodyResult.status, headers: PRIVATE_HEADERS });

  const linkedServerId = sanitizePlayerSavedServerId(bodyResult.value.linked_server_id ?? bodyResult.value.server_id);
  if (!linkedServerId) return json({ error: "Invalid server id." }, { status: 400, headers: PRIVATE_HEADERS });

  const result = await savePlayerServer(env, user.id, linkedServerId);
  if (!result.saved) return json({ error: "Server not found." }, { status: 404, headers: PRIVATE_HEADERS });

  return json({ ok: true, saved: true, linked_server_id: linkedServerId }, { headers: PRIVATE_HEADERS });
}

async function handleDelete(request: Request, env: Env) {
  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Log in with Discord to remove saved servers." }, { status: 401, headers: PRIVATE_HEADERS });
  if (!isSameOriginMutation(request)) return json({ error: "Cross-origin saved server updates are not allowed." }, { status: 403, headers: PRIVATE_HEADERS });

  const url = new URL(request.url);
  const urlServerId = sanitizePlayerSavedServerId(url.searchParams.get("linked_server_id") ?? url.searchParams.get("server_id"));
  const bodyResult = urlServerId ? null : await readBoundedJson<SavedServerBody>(request, 2048);
  if (bodyResult && !bodyResult.ok) return json({ error: bodyResult.message, code: bodyResult.error }, { status: bodyResult.status, headers: PRIVATE_HEADERS });

  const linkedServerId = urlServerId ?? sanitizePlayerSavedServerId(bodyResult?.value.linked_server_id ?? bodyResult?.value.server_id);
  if (!linkedServerId) return json({ error: "Invalid server id." }, { status: 400, headers: PRIVATE_HEADERS });

  await deletePlayerSavedServer(env, user.id, linkedServerId);
  return json({ ok: true, saved: false, linked_server_id: linkedServerId }, { headers: PRIVATE_HEADERS });
}

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

function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
