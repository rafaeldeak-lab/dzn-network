import {
  authorizeCommunityMemberSourceRequest,
  communityMemberSourceSchemaErrorResponse,
  createCommunityMemberCandidate,
  isCommunityMemberSourceSchemaError,
  listCommunityMemberSourceManagement,
  type CommunityMemberCandidateInput,
} from "../../_lib/community-member-source-management";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

const BODY_LIMIT_BYTES = 8 * 1024;

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await authorizeCommunityMemberSourceRequest(env, request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const payload = await listCommunityMemberSourceManagement(env, auth.actor, {
      status: url.searchParams.get("status"),
      linkedServerId: url.searchParams.get("linked_server_id"),
      limit: Number(url.searchParams.get("limit") ?? 80),
    });
    return json(payload, { headers: privateNoStoreHeaders() });
  } catch (error) {
    if (isCommunityMemberSourceSchemaError(error)) {
      return communityMemberSourceSchemaErrorResponse();
    }
    console.warn("DZN community member source management unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "COMMUNITY_MEMBER_SOURCE_MANAGEMENT_UNAVAILABLE",
        message: "Community member source management is temporarily unavailable.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await authorizeCommunityMemberSourceRequest(env, request);
  if (!auth.ok) return auth.response;

  const body = await readBoundedJson<CommunityMemberCandidateInput>(request, BODY_LIMIT_BYTES);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });

  try {
    const result = await createCommunityMemberCandidate(env, auth.actor, body.value);
    return json(result, { status: result.status, headers: privateNoStoreHeaders() });
  } catch (error) {
    if (isCommunityMemberSourceSchemaError(error)) {
      return communityMemberSourceSchemaErrorResponse();
    }
    console.warn("DZN community member candidate create failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "COMMUNITY_MEMBER_CANDIDATE_CREATE_FAILED",
        message: "Community member candidate could not be saved.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};

export const onRequestPatch = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
