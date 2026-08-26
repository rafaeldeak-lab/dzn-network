import {
  authorizeCommunityMemberSourceRequest,
  communityMemberSourceSchemaErrorResponse,
  exportCommunityMemberSourceAudit,
  isCommunityMemberSourceSchemaError,
} from "../../../_lib/community-member-source-management";
import { json, methodNotAllowed } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const auth = await authorizeCommunityMemberSourceRequest(env, request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const result = await exportCommunityMemberSourceAudit(env, auth.actor, {
      linkedServerId: url.searchParams.get("linked_server_id"),
      auditAction: url.searchParams.get("audit_action"),
      auditResult: url.searchParams.get("audit_result"),
      dateFrom: url.searchParams.get("date_from"),
      dateTo: url.searchParams.get("date_to"),
      limit: Number(url.searchParams.get("limit") ?? 160),
    });

    if (!result.ok) {
      return json(result, { status: result.status, headers: privateNoStoreHeaders() });
    }

    const headers = privateNoStoreHeaders({
      "content-type": result.content_type,
      "content-disposition": `attachment; filename="${result.filename}"`,
      "x-dzn-export-safe": "true",
      "x-dzn-export-row-count": String(result.row_count),
      "x-dzn-export-limit": String(result.filters.limit),
      "x-dzn-export-truncated": String(result.truncated),
      "x-dzn-export-generated-at": result.generated_at,
      "x-dzn-export-artifact": "private-owner-admin",
      "x-dzn-export-retention": result.retention.mode,
      "x-dzn-export-persisted-by-dzn": String(result.retention.persisted_by_dzn),
      "x-dzn-export-dashboard-history": result.retention.dashboard_history,
    });

    return new Response(result.body, { status: result.status, headers });
  } catch (error) {
    if (isCommunityMemberSourceSchemaError(error)) {
      return communityMemberSourceSchemaErrorResponse();
    }
    console.warn("DZN community member source audit export failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "COMMUNITY_MEMBER_SOURCE_AUDIT_EXPORT_FAILED",
        message: "Community member source audit export could not be generated.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};
