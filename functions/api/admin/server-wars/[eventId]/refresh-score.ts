import { json, methodNotAllowed } from "../../../../_lib/http";
import { requirePlatformCreatorEventAdmin } from "../../../../_lib/platform-creator";
import { refreshServerWarEventSnapshot } from "../../../../_lib/server-war-snapshots";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const auth = await requirePlatformCreatorEventAdmin(env, request);
  if (!auth.ok) return auth.response;
  const eventId = sanitizeParam(params.eventId);
  if (!eventId) return json({ ok: false, error: "invalid_event_id" }, { status: 400 });
  try {
    const result = await refreshServerWarEventSnapshot(env, eventId);
    return json(result);
  } catch (error) {
    return json({
      ok: false,
      error: "server_war_refresh_failed",
      message: error instanceof Error ? error.message : "Unable to refresh Server War scores.",
    }, { status: 400 });
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 96) : "";
}
