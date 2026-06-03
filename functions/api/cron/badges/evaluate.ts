import { evaluateBadgeBatch } from "../../../_lib/badge-evaluation";
import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

type CronBadgeBody = {
  limit?: unknown;
  includeCrowns?: unknown;
  source?: unknown;
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  try {
    const body = await readJson<CronBadgeBody>(request);
    const result = await evaluateBadgeBatch(env, {
      limit: Number(body.limit ?? 10),
      includeCrowns: body.includeCrowns !== false,
      actor: { role: "cron" },
    });
    return json({
      ok: result.ok,
      evaluated: result.evaluated,
      awarded: result.awarded,
      updatedProgress: result.updatedProgress,
      crownsChanged: result.crownsChanged,
      skipped: result.skipped,
      warnings: result.warnings,
      publicProfileRefresh: result.publicProfileRefresh,
      source: typeof body.source === "string" ? body.source.slice(0, 80) : "cron",
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN cron badge evaluation failed", { requestId, error: error instanceof Error ? error.message : "unknown" });
    return json({
      ok: false,
      error: "BADGE_EVALUATION_UNAVAILABLE",
      errorCode: "BADGE_EVALUATION_UNAVAILABLE",
      message: "Badge evaluation is temporarily unavailable.",
      requestId,
    }, { status: 500 });
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
