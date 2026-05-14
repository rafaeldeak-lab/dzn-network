import { deleteOwnedLinkedServerData, getLinkedServerForDeletion, isDeletionRateLimited, OWNER_DELETE_FORBIDDEN_MESSAGE } from "../../_lib/deletion";
import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type DeleteServerBody = {
  linked_server_id?: string;
  confirmation_text?: string;
  final_confirmed?: boolean;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  if (isDeletionRateLimited(`server-delete:${user.id}`)) {
    return json({ error: "Too many deletion attempts. Wait a minute and try again." }, { status: 429 });
  }

  const body = await readJson<DeleteServerBody>(request);
  const linkedServerId = sanitizeLinkedServerId(body.linked_server_id);
  if (!linkedServerId) return json({ error: "Linked server is required" }, { status: 400 });
  if (body.final_confirmed !== true) return json({ error: "Final confirmation is required" }, { status: 400 });

  const server = await getLinkedServerForDeletion(env, linkedServerId);
  if (!server) return json({ error: "Linked server not found" }, { status: 404 });
  if (server.user_id !== user.id) {
    return json({ error: OWNER_DELETE_FORBIDDEN_MESSAGE }, { status: 403 });
  }

  const confirmation = typeof body.confirmation_text === "string" ? body.confirmation_text.trim() : "";
  if (confirmation !== "DELETE SERVER" && confirmation !== server.server_name) {
    return json({ error: "Confirmation text does not match this server." }, { status: 400 });
  }

  const result = await deleteOwnedLinkedServerData(env, user.id, linkedServerId);
  if (!result.ok) return json({ error: result.error }, { status: result.status });

  return json({
    ok: true,
    deleted: result.deleted,
    redirectTarget: "/setup",
    message: "Server removed from DZN Network.",
  });
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
