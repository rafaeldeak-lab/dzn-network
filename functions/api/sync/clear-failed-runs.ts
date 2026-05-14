import { clearOldFailedSyncRuns } from "../../_lib/adm-sync";
import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type ClearFailedRunsBody = {
  linked_server_id?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<ClearFailedRunsBody>(request);
  try {
    const result = await clearOldFailedSyncRuns(env, user.id, sanitizeLinkedServerId(body.linked_server_id));
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to clear old failed sync runs" }, { status: 400 });
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
