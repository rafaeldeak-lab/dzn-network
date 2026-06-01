import { ensureMockUser, getSessionUser } from "../../../../_lib/db";
import { listOwnerDiscordEventChannels } from "../../../../_lib/event-hub";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { isMockAuth } from "../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to view Discord channels." }, { status: 401 });
  const serverId = sanitizeLinkedServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });
  try {
    const result = await listOwnerDiscordEventChannels(env, user, serverId);
    return json(result.payload, { status: result.status });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN Discord event channel lookup unavailable", { requestId, serverId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "DISCORD_CHANNELS_UNAVAILABLE",
      errorCode: "DISCORD_CHANNELS_UNAVAILABLE",
      message: "Discord channels could not be loaded right now. Retry in a moment.",
      requestId,
      channels: [],
    }, { status: 200 });
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
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
