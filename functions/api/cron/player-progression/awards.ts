import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import {
  runPlayerProgressionAwardJob,
  type TrustedProgressionSourceAdapter,
  type TrustedProgressionAwardSourceInput,
} from "../../../_lib/player-progression";
import type { PagesFunction } from "../../../_lib/types";

type PlayerProgressionAwardsCronBody = {
  limit?: unknown;
  source?: unknown;
  sources?: unknown;
  verified_sources?: unknown;
  collect_sources?: unknown;
  adapters?: unknown;
  retry_failed?: unknown;
};

const BODY_LIMIT_BYTES = 12 * 1024;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const bodyResult = await readBoundedJson<PlayerProgressionAwardsCronBody>(request, BODY_LIMIT_BYTES);
  if (!bodyResult.ok) {
    return json({ ok: false, error: bodyResult.error, message: bodyResult.message }, { status: bodyResult.status });
  }

  try {
    const body = bodyResult.value;
    const sources = normalizeSourceList(body.verified_sources ?? body.sources);
    const result = await runPlayerProgressionAwardJob(env, {
      limit: Number(body.limit ?? 10),
      source: typeof body.source === "string" ? body.source : "cron",
      sources,
      collectSources: body.collect_sources === true || (body.collect_sources !== false && sources.length === 0),
      adapters: normalizeAdapterList(body.adapters),
      retryFailed: body.retry_failed === true,
    });
    return json(result, { status: result.ok ? 200 : 500, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN cron player progression awards failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({
      ok: false,
      taskStatus: "failed",
      task_status: "failed",
      error: "PLAYER_PROGRESSION_AWARDS_UNAVAILABLE",
      errorCode: "PLAYER_PROGRESSION_AWARDS_UNAVAILABLE",
      message: "Player progression awards are temporarily unavailable.",
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

function normalizeSourceList(value: unknown): TrustedProgressionAwardSourceInput[] {
  return Array.isArray(value)
    ? value.filter((item): item is TrustedProgressionAwardSourceInput => Boolean(item && typeof item === "object"))
    : [];
}

function normalizeAdapterList(value: unknown): TrustedProgressionSourceAdapter[] | null {
  return Array.isArray(value)
    ? value.filter((item): item is TrustedProgressionSourceAdapter => typeof item === "string")
    : null;
}
