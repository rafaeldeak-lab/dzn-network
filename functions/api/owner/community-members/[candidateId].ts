import {
  actOnCommunityMemberCandidate,
  authorizeCommunityMemberSourceRequest,
  communityMemberSourceSchemaErrorResponse,
  isCommunityMemberSourceSchemaError,
  type CommunityMemberCandidateActionInput,
} from "../../../_lib/community-member-source-management";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

const BODY_LIMIT_BYTES = 4 * 1024;

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await authorizeCommunityMemberSourceRequest(env, request);
  if (!auth.ok) return auth.response;

  const body = await readBoundedJson<CommunityMemberCandidateActionInput>(request, BODY_LIMIT_BYTES);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });

  try {
    const result = await actOnCommunityMemberCandidate(env, auth.actor, params.candidateId, body.value);
    return json(result, { status: result.status, headers: privateNoStoreHeaders() });
  } catch (error) {
    if (isCommunityMemberSourceSchemaError(error)) {
      return communityMemberSourceSchemaErrorResponse();
    }
    console.warn("DZN community member candidate action failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "COMMUNITY_MEMBER_CANDIDATE_ACTION_FAILED",
        message: "Community member candidate action could not be completed.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};

export const onRequestGet = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
