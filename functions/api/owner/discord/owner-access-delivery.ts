import { getOwnerDiscordDeliveryDiagnostic, revokeOwnerDiscordAccessRole } from "../../../_lib/owner-discord-delivery";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

type DeliveryBody = { action?: unknown; requestId?: unknown; request_id?: unknown };

export const onRequest: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return withHeaders(auth.response, headers);
  if (request.method === "GET") return json(await getOwnerDiscordDeliveryDiagnostic(env), { headers });
  if (request.method === "POST") {
    if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin owner Discord delivery is not allowed." }, { status: 403, headers });
    const body = await readBoundedJson<DeliveryBody>(request, 1_024);
    if (!body.ok) return json({ ok: false, message: body.message }, { status: body.status, headers });
    if (body.value.action !== "revoke_role") return json({ ok: false, message: "Choose the role-removal action." }, { status: 400, headers });
    const result = await revokeOwnerDiscordAccessRole(env, auth.user, body.value);
    return json(result, { status: result.status, headers });
  }
  return methodNotAllowed();
};

function withHeaders(response: Response, headers: Headers) {
  const next = new Headers(response.headers);
  headers.forEach((value, key) => next.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: next });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
