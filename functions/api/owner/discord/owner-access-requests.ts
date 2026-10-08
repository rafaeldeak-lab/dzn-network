import { decideOwnerDiscordAccessRequest, isOwnerDiscordAccessEnabled, listOwnerDiscordAccessRequests } from "../../../_lib/owner-discord-access";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  if (!isOwnerDiscordAccessEnabled(env)) return json({ ok: false, message: "DZN owner Discord access is not enabled on this environment." }, { status: 404, headers });
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return withHeaders(auth.response, headers);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const result = await listOwnerDiscordAccessRequests(env, { status: url.searchParams.get("status"), query: url.searchParams.get("q"), cursor: url.searchParams.get("cursor") });
    return json(result, { status: result.ok ? 200 : result.status, headers });
  }
  if (request.method === "POST") {
    if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin owner-access decisions are not allowed." }, { status: 403, headers });
    const body = await readBoundedJson(request, 2_048);
    if (!body.ok) return json({ ok: false, message: body.message }, { status: body.status, headers });
    const result = await decideOwnerDiscordAccessRequest(env, auth.user, body.value);
    return json(result, { status: result.ok ? 200 : result.status, headers });
  }
  return methodNotAllowed();
};

function withHeaders(response: Response, headers: Headers) { const next = new Headers(response.headers); headers.forEach((value, key) => next.set(key, value)); return new Response(response.body, { status: response.status, statusText: response.statusText, headers: next }); }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
