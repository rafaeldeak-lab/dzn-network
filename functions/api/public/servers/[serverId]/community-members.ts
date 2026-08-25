import { getPublicCommunityMemberDirectoryPayload, publicCommunityMemberDirectorySafeguards } from "../../../../_lib/public-community-members";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../../_lib/public-auth";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const serverId = sanitizeParam(params.serverId);
  if (!serverId) {
    return json({ ok: false, error: "server_not_found", message: "That public DZN server was not found." }, { status: 404 });
  }

  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  try {
    const result = await getPublicCommunityMemberDirectoryPayload(env, serverId);
    return json(result.payload, {
      status: result.status,
      headers: result.status >= 400 ? publicApiErrorHeaders() : publicAccessCacheHeaders(viewerLoggedIn),
    });
  } catch (error) {
    console.warn("DZN PUBLIC COMMUNITY MEMBER DIRECTORY LOAD FAILED", safeError(error));
    return json({
      ok: true,
      available: false,
      source: "unavailable",
      server: {
        public_slug: serverId,
        server_name: "DZN Server",
        href: `/servers/profile?slug=${encodeURIComponent(serverId)}`,
      },
      community: {
        name: "DZN Community",
        icon_url: null,
        member_count: 0,
      },
      members: [],
      message: "Community member directory data could not be loaded right now.",
      profile_attribution: publicCommunityMemberDirectorySafeguards(),
      fetched_at: new Date().toISOString(),
    }, { headers: publicApiErrorHeaders() });
  }
};

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 96);
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
