import { ensureMockUser, getSessionUser } from "../../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { isMockAuth } from "../../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to test Discord event channels." }, { status: 401 });
  const serverId = sanitizeLinkedServerId(params.serverId);
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });
  try {
    const [{ testOwnerDiscordEventChannel }, body] = await Promise.all([
      import("../../../../../_lib/event-hub"),
      readJson<Record<string, unknown>>(request),
    ]);
    const result = await testOwnerDiscordEventChannel(env, user, serverId, body);
    return json(result.payload, { status: result.status });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN Discord event channel test unavailable", { requestId, serverId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "DISCORD_TEST_MESSAGE_FAILED",
      errorCode: "DISCORD_TEST_MESSAGE_FAILED",
      message: "Discord test message failed. Check that DZN Bot can post embeds in the selected channel.",
      requestId,
    }, { status: 502 });
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
