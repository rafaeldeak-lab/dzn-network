import { getRecentAdmSyncEvents } from "../../_lib/adm-sync";
import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  try {
    const events = await getRecentAdmSyncEvents(
      env,
      user.id,
      sanitizeLinkedServerId(url.searchParams.get("linked_server_id")),
      sanitizeLimit(url.searchParams.get("limit")),
    );
    return json({ events }, { headers: privateRecentEventsHeaders() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Recent sync events unavailable" }, { status: 400 });
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

function privateRecentEventsHeaders() {
  return {
    "cache-control": "private, max-age=10",
  };
}
