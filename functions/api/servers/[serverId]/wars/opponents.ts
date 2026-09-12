import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { getServerWarOpponentOptions } from "../../../../_lib/server-wars";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const headers = { "cache-control": "private, no-store", vary: "Cookie" };
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "unauthenticated" }, { status: 401, headers });
  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  if (!serverId || serverId.length > 96) return json({ ok: false, error: "invalid_server_id" }, { status: 400, headers });
  const url = new URL(request.url);
  try {
    const payload = await getServerWarOpponentOptions(env, user, serverId, url.searchParams.get("search") ?? "", url.searchParams.get("ruleset") ?? "", Number(url.searchParams.get("offset")));
    return json(payload, { status: payload.ok ? 200 : payload.status, headers });
  } catch {
    return json({ ok: false, error: "opponents_unavailable", message: "Server choices are temporarily unavailable. Please try again." }, { status: 503, headers });
  }
};
