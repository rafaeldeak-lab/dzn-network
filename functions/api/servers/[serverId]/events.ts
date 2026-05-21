import { getSessionUser } from "../../../_lib/db";
import { getServerEventsProfilePayload } from "../../../_lib/events";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const serverIdOrSlug = typeof params.serverId === "string" ? params.serverId : "";
  if (!serverIdOrSlug.trim()) return json({ ok: false, error: "INVALID_SERVER", message: "Invalid server." }, { status: 400 });
  const viewer = await getSessionUser(env, request).catch(() => null);
  const payload = await getServerEventsProfilePayload(env, serverIdOrSlug, viewer);
  return json(payload, {
    headers: {
      "cache-control": viewer ? "private, no-store" : "public, max-age=15, stale-while-revalidate=45",
      vary: "Cookie",
    },
  });
};
