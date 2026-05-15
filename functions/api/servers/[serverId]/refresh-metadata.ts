import { ensureMockUser, getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { refreshNitradoServerMetadata } from "../../../_lib/server-metadata";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  try {
    const result = await refreshNitradoServerMetadata(env, {
      linkedServerId,
      userId: user.id,
      force: true,
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to refresh server metadata" }, { status: 400 });
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
