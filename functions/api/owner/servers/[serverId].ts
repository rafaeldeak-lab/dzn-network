import { json, methodNotAllowed } from "../../../_lib/http";
import { recordOwnerSupportAccess } from "../../../_lib/owner-discord-control";
import { getOwnerServer } from "../../../_lib/owner-console";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request, params }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  const serverId = String(params.serverId ?? "").trim();
  const server = serverId ? await getOwnerServer(env, serverId) : null;
  if (!server) return json({ ok: false, error: "not_found" }, { status: 404 });

  await recordOwnerSupportAccess(env, auth.user, server.id, request.headers.get("cf-ray"));

  return json({ ok: true, server });
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
