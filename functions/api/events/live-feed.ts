import { getLiveEventFeedPayload } from "../../_lib/events";
import { json, methodNotAllowed } from "../../_lib/http";
import { noStoreForErrorHeaders, publicCacheHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const url = new URL(request.url);
  const payload = await getLiveEventFeedPayload(env, Number(url.searchParams.get("limit") ?? 25));
  const status = Number((payload as { status?: number }).status ?? 200);
  return json(payload, {
    status,
    headers: status >= 400 ? noStoreForErrorHeaders() : publicCacheHeaders({ maxAge: 10, staleWhileRevalidate: 30 }),
  });
};
