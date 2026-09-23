import { json, methodNotAllowed } from "../../../_lib/http";
import { recordOwnerSupportAccess } from "../../../_lib/owner-discord-control";
import { getOwnerServer } from "../../../_lib/owner-console";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type OwnerServerDetailDependencies = {
  authorize: (env: Env, request: Request) => ReturnType<typeof requirePlatformOwner>;
  loadServer: typeof getOwnerServer;
  auditAccess: (env: Env, user: SessionUser, serverId: string, requestId: string | null) => Promise<void>;
};

export function createOwnerServerDetailHandler(dependencies: OwnerServerDetailDependencies): PagesFunction {
  return async ({ env, request, params }) => {
    const auth = await dependencies.authorize(env, request);
    if (!auth.ok) return auth.response;

    const serverId = String(params.serverId ?? "").trim();
    const server = serverId ? await dependencies.loadServer(env, serverId) : null;
    if (!server) return json({ ok: false, error: "not_found" }, { status: 404 });

    await dependencies.auditAccess(env, auth.user, server.id, request.headers.get("cf-ray"));

    return json({ ok: true, server });
  };
}

export const onRequestGet = createOwnerServerDetailHandler({
  authorize: requirePlatformOwner,
  loadServer: getOwnerServer,
  auditAccess: recordOwnerSupportAccess,
});

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
