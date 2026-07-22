import { getSessionUser } from "../../../_lib/db";
import { createEventSuggestion, listPublicEventSuggestions, type EventSuggestionInput } from "../../../_lib/event-suggestions";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { finalizeServerTiming, makeRequestId, measureD1, privateNoStoreHeaders, publicCacheHeaders, safePerformanceWarning, withPublicGetEdgeCache, type SafeRouteMetrics } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;
  const metrics: SafeRouteMetrics = {
    requestId: makeRequestId("suggestions"),
    routeName: "/api/events/suggestions",
    startedAt: performance.now(),
  };
  return withPublicGetEdgeCache(context, {
    ttl: { maxAge: 15, staleWhileRevalidate: 45 },
    allowedParams: ["sort", "status", "limit", "cursor"],
    cacheVersion: "event-suggestions-v2",
    buildResponse: async () => {
      const url = new URL(request.url);
      const payload = await measureD1(metrics, () => listPublicEventSuggestions(env, {
        sort: url.searchParams.get("sort"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit"),
        cursor: url.searchParams.get("cursor"),
      }));
      metrics.resultCount = Array.isArray((payload as Record<string, unknown>).suggestions) ? ((payload as Record<string, unknown>).suggestions as unknown[]).length : 0;
      const headers = finalizeServerTiming(publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }), metrics);
      safePerformanceWarning(metrics);
      return json(payload, { status: Number((payload as { status?: number }).status ?? 200), headers });
    },
  });
};

export const onRequestHead: PagesFunction = async (context) => {
  return onRequestGet(context);
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const user = await getSessionUser(env, request).catch(() => null);
  const body = await readBoundedJson<EventSuggestionInput>(request, 12 * 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await createEventSuggestion(env, user, body.value);
  return json(result, {
    status: result.status,
    headers: privateNoStoreHeaders(),
  });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
