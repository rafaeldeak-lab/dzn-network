import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { readOwnerPlayerGameIdentityClaims } from "../../_lib/player-game-identities";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to review game identity claims." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }

  const historyCursor = parseHistoryCursor(new URL(request.url).searchParams.get("history_before"));
  return json(await readOwnerPlayerGameIdentityClaims(env, user, { historyCursor }), { headers: privateNoStoreHeaders() });
};

function parseHistoryCursor(value: string | null) {
  if (!value || value.length > 256) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== "string" || createdAt.length < 10 || createdAt.length > 64) return null;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
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
