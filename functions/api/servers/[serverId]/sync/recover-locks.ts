import { recoverStuckSyncLocksForServer } from "../../../../_lib/automation";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const user = await getSessionUser(env, request);
  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    return json({ error: access.reason === "not_found" ? "Server not found" : "Forbidden" }, { status: access.reason === "not_found" ? 404 : 403 });
  }

  return json(await recoverStuckSyncLocksForServer(env, linkedServerId), {
    headers: {
      "cache-control": "private, no-store, no-cache, must-revalidate",
      vary: "Cookie",
    },
  });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}
