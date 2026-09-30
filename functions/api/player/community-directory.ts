import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { decidePlayerCommunityDirectoryInvite, listPlayerCommunityDirectoryInvites } from "../../_lib/server-community-directory";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "PATCH") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: privateNoStoreHeaders() });
  if (request.method === "GET") return json({ ok: true, invitations: await listPlayerCommunityDirectoryInvites(env, user.id) }, { headers: privateNoStoreHeaders() });
  if (!sameOrigin(request)) return json({ ok: false, error: "FORBIDDEN" }, { status: 403, headers: privateNoStoreHeaders() });
  const parsed = await readBoundedJson<{ id?: unknown; approve?: unknown }>(request, 1024);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, { status: parsed.status, headers: privateNoStoreHeaders() });
  const id = typeof parsed.value.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(parsed.value.id) ? parsed.value.id : "";
  if (!id || typeof parsed.value.approve !== "boolean") return json({ ok: false, error: "INVALID_DECISION" }, { status: 400, headers: privateNoStoreHeaders() });
  const changed = await decidePlayerCommunityDirectoryInvite(env, user, id, parsed.value.approve);
  return changed ? json({ ok: true }, { headers: privateNoStoreHeaders() }) : json({ ok: false, error: "INVITATION_NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
