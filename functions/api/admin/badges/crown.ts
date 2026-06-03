import {
  BadgeEvaluationError,
  manualTransferCrown,
  requireBadgeAdminUser,
} from "../../../_lib/badge-evaluation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

type CrownBody = {
  serverId?: unknown;
  crownCode?: unknown;
  reason?: unknown;
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireBadgeAdminUser(env, request);
  if (!auth.ok) return json(auth.payload, { status: auth.status });

  try {
    const body = await readJson<CrownBody>(request);
    const result = await manualTransferCrown(env, {
      serverId: requireString(body.serverId),
      crownCode: requireString(body.crownCode),
      reason: typeof body.reason === "string" ? body.reason : null,
      actor: { userId: auth.user.id, role: auth.role },
    });
    return json(result);
  } catch (error) {
    return badgeEndpointError(error, "Crown transfer is temporarily unavailable.");
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

function requireString(value: unknown) {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next) throw new BadgeEvaluationError("VALIDATION_FAILED", "serverId and crownCode are required.", 400);
  return next;
}

function badgeEndpointError(error: unknown, fallbackMessage: string) {
  if (error instanceof BadgeEvaluationError) {
    return json({
      ok: false,
      error: error.errorCode,
      errorCode: error.errorCode,
      message: error.message,
    }, { status: error.status });
  }
  const requestId = crypto.randomUUID();
  console.warn("DZN crown endpoint failed", { requestId, error: error instanceof Error ? error.message : "unknown" });
  return json({
    ok: false,
    error: "CROWN_TRANSFER_UNAVAILABLE",
    errorCode: "CROWN_TRANSFER_UNAVAILABLE",
    message: fallbackMessage,
    requestId,
  }, { status: 500 });
}
