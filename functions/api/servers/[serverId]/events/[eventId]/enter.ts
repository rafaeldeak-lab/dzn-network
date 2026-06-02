import { ensureMockUser, getSessionUser } from "../../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../../_lib/http";
import { isMockAuth } from "../../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to enter events." }, { status: 401 });
  const serverId = sanitizeIdentifier(params.serverId);
  const eventId = sanitizeIdentifier(params.eventId);
  if (!serverId || !eventId) return json({ ok: false, error: "VALIDATION_FAILED", message: "Invalid server or event id." }, { status: 400 });
  try {
    const { enterOwnerEvent } = await import("../../../../../_lib/event-hub");
    const result = await enterOwnerEvent(env, user, serverId, eventId);
    return json(result.payload, { status: result.status });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN owner event entry unavailable", { requestId, serverId, eventId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "SETTINGS_UNAVAILABLE",
      errorCode: "SETTINGS_UNAVAILABLE",
      message: "Event entry is temporarily unavailable. Please try again.",
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

function sanitizeIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{3,128}$/.test(value) ? value : "";
}
