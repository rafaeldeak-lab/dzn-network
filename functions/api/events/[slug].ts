import { getSessionUser } from "../../_lib/db";
import { getEventDetailPayload } from "../../_lib/events";
import { json, methodNotAllowed } from "../../_lib/http";
import { noStoreForErrorHeaders, privateNoStoreHeaders, publicCacheHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug.trim()) return json({ ok: false, error: "INVALID_EVENT", message: "Invalid event slug." }, { status: 400 });
  const viewer = await getSessionUser(env, request).catch(() => null);
  const url = new URL(request.url);
  const payload = await getEventDetailPayload(env, viewer, slug, {
    full: url.searchParams.get("full")?.trim().toLowerCase() === "true",
  });
  const status = Number((payload as { status?: number }).status ?? 200);
  return json(payload, {
    status,
    headers: viewer
      ? privateNoStoreHeaders()
      : status >= 400
        ? noStoreForErrorHeaders()
        : publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 }),
  });
};
