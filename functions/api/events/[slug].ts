import { getSessionUser } from "../../_lib/db";
import { getEventDetailPayload } from "../../_lib/events";
import { json, methodNotAllowed } from "../../_lib/http";
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
  return json(payload, {
    headers: {
      "cache-control": viewer ? "private, no-store" : "public, max-age=15, stale-while-revalidate=45",
      vary: "Cookie",
    },
  });
};
