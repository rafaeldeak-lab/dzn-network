import {
  authorizeCommunityMemberSourceRequest,
  bulkActOnCommunityMemberCandidates,
  communityMemberSourceSchemaErrorResponse,
  isCommunityMemberSourceSchemaError,
  type CommunityMemberBulkCandidateActionInput,
} from "../../../_lib/community-member-source-management";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

const BODY_LIMIT_BYTES = 12 * 1024;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const auth = await authorizeCommunityMemberSourceRequest(env, request);
  if (!auth.ok) return auth.response;

  const body = await readBoundedJson<CommunityMemberBulkCandidateActionInput>(request, BODY_LIMIT_BYTES);
  if (!body.ok) {
    return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  }

  try {
    const result = await bulkActOnCommunityMemberCandidates(env, auth.actor, body.value);
    return json(result, { status: result.status, headers: privateNoStoreHeaders() });
  } catch (error) {
    if (isCommunityMemberSourceSchemaError(error)) {
      return communityMemberSourceSchemaErrorResponse();
    }
    console.warn("DZN community member candidate bulk action failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "COMMUNITY_MEMBER_CANDIDATE_BULK_ACTION_FAILED",
        message: "Selected community member candidates could not be processed.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};
