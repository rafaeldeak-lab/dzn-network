import {
  BadgeEvaluationError,
  evaluateBadgeBatch,
  requireBadgeAdminUser,
} from "../../../_lib/badge-evaluation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

type EvaluateBody = {
  serverId?: unknown;
  mode?: unknown;
  limit?: unknown;
  includeCrowns?: unknown;
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const auth = await requireBadgeAdminUser(env, request);
  if (!auth.ok) return json(auth.payload, { status: auth.status });

  try {
    const body = await readJson<EvaluateBody>(request);
    const mode = normalizeMode(body.mode);
    const serverId = typeof body.serverId === "string" ? body.serverId.trim() : null;
    if (mode === "single" && !serverId) {
      return json({
        ok: false,
        error: "SERVER_REQUIRED",
        errorCode: "SERVER_REQUIRED",
        message: "serverId is required for single-server badge evaluation.",
      }, { status: 400 });
    }

    const result = await evaluateBadgeBatch(env, {
      serverId: mode === "single" ? serverId : null,
      limit: Number(body.limit ?? 10),
      includeCrowns: body.includeCrowns !== false,
      actor: { userId: auth.user.id, role: auth.role },
    });
    return json({
      ok: true,
      evaluated: result.evaluated,
      awarded: result.awarded,
      updatedProgress: result.updatedProgress,
      crownsChanged: result.crownsChanged,
      skipped: result.skipped,
      warnings: result.warnings,
      publicProfileRefresh: result.publicProfileRefresh,
    });
  } catch (error) {
    return badgeEndpointError(error, "Badge evaluation is temporarily unavailable.");
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

function normalizeMode(value: unknown): "single" | "batch" | "all" {
  const mode = String(value ?? "batch").trim().toLowerCase();
  if (mode === "single" || mode === "all") return mode;
  return "batch";
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
  console.warn("DZN badge evaluation endpoint failed", { requestId, error: error instanceof Error ? error.message : "unknown" });
  return json({
    ok: false,
    error: "BADGE_EVALUATION_UNAVAILABLE",
    errorCode: "BADGE_EVALUATION_UNAVAILABLE",
    message: fallbackMessage,
    requestId,
  }, { status: 500 });
}
