import { ensureMockUser, getCurrentLinkedServer, getSessionUser } from "../../_lib/db";
import { json } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { isMetadataStale, refreshMetadataIfStale } from "../../_lib/server-metadata";
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

  let linkedServer = await getCurrentLinkedServer(env, user.id);
  if (
    linkedServer &&
    typeof linkedServer.id === "string" &&
    typeof linkedServer.nitrado_service_id === "string" &&
    isMetadataStale(typeof linkedServer.metadata_last_checked_at === "string" ? linkedServer.metadata_last_checked_at : null)
  ) {
    await refreshMetadataIfStale(env, linkedServer.id, user.id);
    linkedServer = await getCurrentLinkedServer(env, user.id);
  }
  return json({ authenticated: true, user, linkedServer });
};
