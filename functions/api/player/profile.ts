import { json, methodNotAllowed } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import { getPlayerProfileProgressionPayload } from "../../_lib/player-profile-progression";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) {
    return json({ error: "Unauthorized" }, { status: 401, headers: privateNoStoreHeaders() });
  }

  return json(await getPlayerProfileProgressionPayload(env, user), {
    headers: privateNoStoreHeaders(),
  });
};
