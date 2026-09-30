import { getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requireServerOwnerOrDznAdmin } from "../../../_lib/public-cache";
import { addCommunityMember, listManagedCommunityMembers, removeCommunityMember, resolvePublishedCommunityMember, updateCommunityMember } from "../../../_lib/server-community-directory";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) return methodNotAllowed();
  const user = await getSessionUser(env, request);
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const access = await requireServerOwnerOrDznAdmin(env, user, serverId);
  if (!access.allowed || !user) {
    const status = access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403;
    return json({ ok: false, error: access.reason ?? "forbidden" }, { status, headers: privateNoStoreHeaders() });
  }
  if (request.method === "GET") {
    return json({ ok: true, members: await listManagedCommunityMembers(env, serverId) }, { headers: privateNoStoreHeaders() });
  }
  if (!sameOrigin(request)) return json({ ok: false, error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  const parsed = await readBoundedJson<{ id?: unknown; handle?: unknown; role_label?: unknown; publish?: unknown }>(request, 2048);
  if (!parsed.ok) return json({ ok: false, error: parsed.error, message: parsed.message }, { status: parsed.status, headers: privateNoStoreHeaders() });
  if (request.method === "PATCH" || request.method === "DELETE") {
    const memberId = typeof parsed.value.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(parsed.value.id) ? parsed.value.id : "";
    if (!memberId) return json({ ok: false, error: "INVALID_MEMBER" }, { status: 400, headers: privateNoStoreHeaders() });
    const changed = request.method === "PATCH"
      ? await updateCommunityMember(env, user, serverId, memberId, parsed.value.publish)
      : await removeCommunityMember(env, user, serverId, memberId);
    return changed
      ? json({ ok: true }, { headers: privateNoStoreHeaders() })
      : json({ ok: false, error: "MEMBER_NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
  }
  const member = await resolvePublishedCommunityMember(env, parsed.value.handle);
  if (!member) return json({ ok: false, error: "PROFILE_NOT_FOUND", message: "Use an active, public DZN profile handle." }, { status: 404, headers: privateNoStoreHeaders() });
  const saved = await addCommunityMember(env, user, serverId, member.user_id, parsed.value.role_label, parsed.value.publish);
  return json({ ok: true, member: { handle: member.handle, display_name: member.username, ...saved } }, { status: 201, headers: privateNoStoreHeaders() });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
