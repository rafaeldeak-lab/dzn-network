import { ensureMockUser, getSessionUser } from "../../../../../_lib/db";
import { saveOwnerDiscordEventChannels } from "../../../../../_lib/event-hub";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { isMockAuth } from "../../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to save Discord event channels." }, { status: 401 });
  const serverId = sanitizeLinkedServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });
  try {
    const body = await readJson<Record<string, unknown>>(request);
    const result = await saveOwnerDiscordEventChannels(env, user, serverId, body);
    return json(result.payload, { status: result.status });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN Discord event channel save unavailable", { requestId, serverId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "SETTINGS_UNAVAILABLE",
      errorCode: "SETTINGS_UNAVAILABLE",
      message: "Discord event channel settings are temporarily unavailable. Please try again.",
      requestId,
    }, { status: 500 });
  }
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
