import { readPublicServerCommunityDirectory } from "../../../../_lib/server-community-directory";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { noStoreForErrorHeaders, privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const payload = await readPublicServerCommunityDirectory(env, params.slug);
  if (!payload) return json({ ok: false, error: "COMMUNITY_NOT_FOUND", message: "That public community was not found." }, { status: 404, headers: noStoreForErrorHeaders() });
  return json(payload, { headers: privateNoStoreHeaders() });
};
