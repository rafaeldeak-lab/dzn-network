import { getLiveEventFeedPayload } from "../../_lib/events";
import { json, methodNotAllowed } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const url = new URL(request.url);
  const payload = await getLiveEventFeedPayload(env, Number(url.searchParams.get("limit") ?? 25));
  return json(payload, {
    headers: {
      "cache-control": "public, max-age=10, stale-while-revalidate=30",
    },
  });
};
