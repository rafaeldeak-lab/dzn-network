import { getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requireServerOwnerOrDznAdmin } from "../../../_lib/public-cache";
import { exportCommunityMemberSourceAudit } from "../../../_lib/server-community-member-sources";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const access = await requireServerOwnerOrDznAdmin(env, user, serverId);
  if (!access.allowed || !user) {
    const status = access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403;
    return json({ ok: false, error: access.reason ?? "forbidden" }, { status, headers: privateNoStoreHeaders() });
  }

  try {
    const url = new URL(request.url);
    const result = await exportCommunityMemberSourceAudit(env, user, serverId, {
      action: url.searchParams.get("action"),
      result: url.searchParams.get("result"),
      limit: url.searchParams.get("limit"),
    });
    return new Response(result.body, {
      status: result.status,
      headers: privateNoStoreHeaders({
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "x-dzn-export-safe": "true",
        "x-dzn-export-row-count": String(result.rowCount),
        "x-dzn-export-limit": String(result.limit),
        "x-dzn-export-truncated": String(result.truncated),
        "x-dzn-export-retention": result.policy.persistence,
        "x-dzn-export-history": result.policy.exportHistory,
      }),
    });
  } catch {
    return json({ ok: false, error: "COMMUNITY_SOURCE_EXPORT_UNAVAILABLE", message: "The private audit export is not available yet." }, { status: 503, headers: privateNoStoreHeaders() });
  }
};
