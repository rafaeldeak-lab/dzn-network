import { ensureMockUser, getSessionUser } from "../../../../../_lib/db";
import { enterOwnerEvent } from "../../../../../_lib/event-hub";
import { json, methodNotAllowed } from "../../../../../_lib/http";
import { isMockAuth } from "../../../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in to enter events." }, { status: 401 });
  const serverId = sanitizeIdentifier(params.serverId);
  const eventId = sanitizeIdentifier(params.eventId);
  if (!serverId || !eventId) return json({ ok: false, error: "VALIDATION_FAILED", message: "Invalid server or event id." }, { status: 400 });
  const result = await enterOwnerEvent(env, user, serverId, eventId);
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

function sanitizeIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{3,128}$/.test(value) ? value : "";
}
