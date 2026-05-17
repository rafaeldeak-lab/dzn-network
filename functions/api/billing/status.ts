import { ensureMockUser, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { getOwnerBillingStatus } from "../../_lib/plans";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  return json(await getOwnerBillingStatus(env, user));
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
