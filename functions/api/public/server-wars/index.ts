import { json, methodNotAllowed } from "../../../_lib/http";
import { getPublicServerWarsPayload } from "../../../_lib/server-wars";
import { publicAccessCacheHeaders, publicApiErrorHeaders } from "../../../_lib/public-auth";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const url = new URL(request.url);
  const limit = numberParam(url.searchParams.get("limit"), 12);
  try {
    const payload = await getPublicServerWarsPayload(env, { limit });
    return json(payload, { headers: publicAccessCacheHeaders(false) });
  } catch (error) {
    console.warn("DZN SERVER WARS PUBLIC LOAD FAILED", safeError(error));
    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      rulesets: [],
      events: [],
      champions: [],
      stale: true,
      fallback_reason: "server_wars_public_load_failed",
      message: "Server Wars are temporarily unavailable. Core site pages remain live.",
    }, { headers: publicApiErrorHeaders() });
  }
};

function numberParam(value: string | null, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 30)) : fallback;
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
}
