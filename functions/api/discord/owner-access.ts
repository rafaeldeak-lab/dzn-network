import { createOwnerDiscordAccessRequest, getOwnerDiscordAccessApplicant, isOwnerDiscordAccessEnabled } from "../../_lib/owner-discord-access";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  if (!isOwnerDiscordAccessEnabled(env)) return json({ ok: false, message: "DZN owner Discord access is not enabled on this environment." }, { status: 404, headers });
  if (request.method === "GET") {
    const result = await getOwnerDiscordAccessApplicant(env, request);
    return json(result, { status: result.ok ? 200 : result.status, headers });
  }
  if (request.method === "POST") {
    if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin owner-access requests are not allowed." }, { status: 403, headers });
    const body = await readBoundedJson(request, 2_048);
    if (!body.ok) return json({ ok: false, message: body.message }, { status: body.status, headers });
    const result = await createOwnerDiscordAccessRequest(env, request, body.value);
    return json(result, { status: result.ok ? 201 : result.status, headers });
  }
  return methodNotAllowed();
};

function sameOrigin(request: Request) { const origin = request.headers.get("origin"); if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false; try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; } }
