import { createEventEntryNotification } from "../../../_lib/dzn-pulse";
import { joinCompetitiveEvent } from "../../../_lib/events";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { ownerAccessErrorResponse, requireOwnerRequestAccess } from "../../../_lib/owner-access";
import type { PagesFunction } from "../../../_lib/types";

type JoinBody = {
  server_id?: string;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const ownerAccess = await requireOwnerRequestAccess(env, request);
  if (!ownerAccess.allowed) return ownerAccessErrorResponse(ownerAccess);
  const viewer = ownerAccess.user;
  const body = await readJson<JoinBody>(request);
  const result = await joinCompetitiveEvent(env, viewer, typeof params.slug === "string" ? params.slug : "", body.server_id ?? "");
  if (viewer && result.ok && typeof result.event_id === "string" && typeof result.server_id === "string") {
    await createEventEntryNotification(env, {
      userId: viewer.id,
      serverId: result.server_id,
      eventId: result.event_id,
      eventSlug: typeof result.event_slug === "string" ? result.event_slug : null,
      eventName: typeof result.event_name === "string" ? result.event_name : null,
      serverName: typeof result.server_name === "string" ? result.server_name : null,
    }).catch(() => null);
  }
  return json(result, { status: result.status });
};
