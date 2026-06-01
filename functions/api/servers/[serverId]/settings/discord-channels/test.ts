import { ensureMockUser, getSessionUser } from "../../../../../_lib/db";
import { testOwnerDiscordEventChannel } from "../../../../../_lib/event-hub";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { isMockAuth } from "../../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to test Discord event channels." }, { status: 401 });
  const serverId = sanitizeLinkedServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });
  const body = await readJson<Record<string, unknown>>(request);
  const result = await testOwnerDiscordEventChannel(env, user, serverId, body);
  return json(result.payload, { status: result.status });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  const mock = await ensureMockUser(env);
  return { id: mock.userId, discord_id: mock.user.id, username: mock.user.username, avatar: mock.user.avatar };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,96}$/.test(value) ? value : "";
}
