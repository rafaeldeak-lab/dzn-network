import { authorizeProgressionAwardAuditRequest, listProgressionAwardAudit } from "../../../_lib/player-progression-awards-audit";
import { json, methodNotAllowed } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const auth = await authorizeProgressionAwardAuditRequest(env, request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const payload = await listProgressionAwardAudit(env, auth.actor, {
      status: url.searchParams.get("status"),
      adapterKey: url.searchParams.get("adapter_key") ?? url.searchParams.get("adapter"),
      linkedServerId: url.searchParams.get("linked_server_id"),
      retry: url.searchParams.get("retry"),
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    return json(payload, { headers: privateNoStoreHeaders() });
  } catch (error) {
    console.warn("DZN progression award audit unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        error: "PROGRESSION_AWARD_AUDIT_UNAVAILABLE",
        message: "Progression award audit history is temporarily unavailable.",
      },
      { status: 500, headers: privateNoStoreHeaders() },
    );
  }
};

export const onRequestPost = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
