import { ensureMockUser, getCurrentLinkedServer, getSessionUser } from "../../_lib/db";
import { json } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  let user = await getSessionUser(env, request);

  if (!user && isMockAuth(env.MOCK_AUTH)) {
    const mock = await ensureMockUser(env);
    user = {
      id: mock.userId,
      discord_id: mock.user.id,
      username: mock.user.username,
      avatar: mock.user.avatar,
    };
  }

  if (!user) {
    return json({ authenticated: false }, { status: 401 });
  }

  const linkedServer = await getCurrentLinkedServer(env, user.id);
  return json({ authenticated: true, user, linkedServer });
};
