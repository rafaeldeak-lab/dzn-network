import { getSessionUser } from "../_lib/db";
import { getEventsListPayload } from "../_lib/events";
import { json, methodNotAllowed } from "../_lib/http";
import { hasPrivateRequestSignal, privateNoStoreHeaders, publicCacheHeaders } from "../_lib/performance";
import type { PagesFunction } from "../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const privateRequest = hasPrivateRequestSignal(request);
  const viewer = await getSessionUser(env, request).catch(() => null);
  const url = new URL(request.url);
  const payload = await getEventsListPayload(env, viewer, {
    status: url.searchParams.get("status"),
    category: url.searchParams.get("category"),
    type: url.searchParams.get("type"),
    full: url.searchParams.get("full")?.trim().toLowerCase() === "true",
    limit: Number(url.searchParams.get("limit") ?? 0),
  });
  return json(payload, {
    headers: viewer || privateRequest
      ? privateNoStoreHeaders()
      : publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }),
  });
};
