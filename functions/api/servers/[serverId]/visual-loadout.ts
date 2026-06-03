import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import {
  getAvailableFramesForServer,
  getAvailableShowcaseBadgesForServer,
  getAvailableThemesForServer,
  resolveOwnerVisualLoadoutServer,
  resolveServerVisualLoadout,
  saveServerVisualLoadout,
  VisualLoadoutError,
  type VisualLoadoutInput,
} from "../../../_lib/server-visual-loadouts";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const [loadout, availableFrames, availableThemes, availableShowcaseBadges] = await Promise.all([
      resolveServerVisualLoadout(env, access.server.id),
      getAvailableFramesForServer(env, access.server.id),
      getAvailableThemesForServer(env, access.server.id),
      getAvailableShowcaseBadgesForServer(env, access.server.id),
    ]);

    return json({
      ok: true,
      server: publicServerSummary(access.server),
      loadout,
      availableFrames,
      availableThemes,
      availableShowcaseBadges,
      limits: loadout.limits,
    });
  } catch (error) {
    return unavailableResponse("VISUAL_LOADOUT_UNAVAILABLE", error, access.server.id);
  }
};

export const onRequestPut: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const body = await readJson<VisualLoadoutInput>(request);
    const loadout = await saveServerVisualLoadout(env, access.server.id, access.user.id, body);
    const [availableFrames, availableThemes, availableShowcaseBadges] = await Promise.all([
      getAvailableFramesForServer(env, access.server.id),
      getAvailableThemesForServer(env, access.server.id),
      getAvailableShowcaseBadgesForServer(env, access.server.id),
    ]);

    return json({
      ok: true,
      message: "Visual loadout saved.",
      server: publicServerSummary(access.server),
      loadout,
      availableFrames,
      availableThemes,
      availableShowcaseBadges,
      limits: loadout.limits,
    });
  } catch (error) {
    if (error instanceof VisualLoadoutError) {
      return json(errorPayload(error.errorCode, error.message), { status: error.status });
    }
    return unavailableResponse("VISUAL_LOADOUT_UNAVAILABLE", error, access.server.id);
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, PUT, OPTIONS" },
});

function publicServerSummary(server: {
  id: string;
  nitrado_service_id: string | null;
  public_slug: string | null;
  server_name: string | null;
  server_category: string | null;
  plan_key: string | null;
  subscription_status: string | null;
}) {
  return {
    id: server.id,
    serviceId: server.nitrado_service_id,
    publicSlug: server.public_slug,
    name: server.server_name,
    category: server.server_category,
    planKey: server.plan_key,
    subscriptionStatus: server.subscription_status,
  };
}

function errorPayload(errorCode: string, message: string, requestId?: string) {
  return {
    ok: false,
    error: errorCode,
    errorCode,
    message,
    ...(requestId ? { requestId } : {}),
  };
}

function unavailableResponse(errorCode: string, error: unknown, serverId: string) {
  const requestId = crypto.randomUUID();
  console.warn("DZN visual loadout unavailable", {
    requestId,
    serverId,
    error: error instanceof Error ? error.message : "unknown",
  });
  return json(
    errorPayload(errorCode, "Visual loadout settings are temporarily unavailable. Please retry.", requestId),
    { status: 500 },
  );
}
