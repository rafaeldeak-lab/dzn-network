import { markCommunityMemberImportNotificationsRead } from "../../../../_lib/dzn-pulse";
import {
  authorizeCommunityMemberSourceRequest,
  communityMemberSourceSchemaErrorResponse,
  isCommunityMemberSourceSchemaError,
} from "../../../../_lib/community-member-source-management";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await authorizeCommunityMemberSourceRequest(env, request);
  if (!auth.ok) return auth.response;

  try {
    const result = await markCommunityMemberImportNotificationsRead(env, auth.actor.user);
    return json(result, { status: result.status, headers: privateNoStoreHeaders() });
  } catch (error) {
    if (isCommunityMemberSourceSchemaError(error)) {
      return communityMemberSourceSchemaErrorResponse();
    }
    console.warn("DZN community member import alert read-state update failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "COMMUNITY_MEMBER_IMPORT_ALERT_READ_STATE_FAILED",
        message: "Community member import alerts could not be marked read.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};
