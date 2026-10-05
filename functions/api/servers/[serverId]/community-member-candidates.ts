import { getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requireServerOwnerOrDznAdmin } from "../../../_lib/public-cache";
import { createCommunityMemberCandidate, decideCommunityMemberCandidate, listCommunityMemberSourceQueue } from "../../../_lib/server-community-member-sources";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (!["GET", "POST", "PATCH"].includes(request.method)) return methodNotAllowed();
  const user = await getSessionUser(env, request);
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const access = await requireServerOwnerOrDznAdmin(env, user, serverId);
  if (!access.allowed || !user) {
    const status = access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403;
    return json({ ok: false, error: access.reason ?? "forbidden" }, { status, headers: privateNoStoreHeaders() });
  }
  if (request.method === "GET") {
    try {
      return json({ ok: true, ...(await listCommunityMemberSourceQueue(env, user, serverId)) }, { headers: privateNoStoreHeaders() });
    } catch {
      return unavailable();
    }
  }
  if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  const body = await readBoundedJson<Record<string, unknown>>(request, 4096);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return json({ ok: false, error: "INVALID_BODY", message: "Request body must be a JSON object." }, { status: 400, headers: privateNoStoreHeaders() });
  }
  try {
    const result = request.method === "POST"
      ? await createCommunityMemberCandidate(env, user, serverId, {
          discordId: body.value.discord_id,
          username: body.value.username,
          roleLabel: body.value.role_label,
        })
      : await decideCommunityMemberCandidate(env, user, serverId, body.value.id, body.value.action, body.value.reason);
    return json(result, { status: result.status, headers: privateNoStoreHeaders() });
  } catch {
    return unavailable();
  }
};

function unavailable() {
  return json({ ok: false, error: "COMMUNITY_SOURCE_QUEUE_UNAVAILABLE", message: "The private source queue is not available yet." }, { status: 503, headers: privateNoStoreHeaders() });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
