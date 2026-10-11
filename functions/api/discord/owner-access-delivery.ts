import { claimOwnerDiscordAccessRole, issueOwnerDiscordAccessInvite } from "../../_lib/owner-discord-delivery";
import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { PagesFunction } from "../../_lib/types";

type DeliveryBody = { action?: unknown; requestId?: unknown; request_id?: unknown };

export const onRequest: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  if (request.method !== "POST") return methodNotAllowed();
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin owner Discord delivery is not allowed." }, { status: 403, headers });
  const body = await readBoundedJson<DeliveryBody>(request, 1_024);
  if (!body.ok) return json({ ok: false, message: body.message }, { status: body.status, headers });

  const result = body.value.action === "invite"
    ? await issueOwnerDiscordAccessInvite(env, request, body.value)
    : body.value.action === "claim"
      ? await claimOwnerDiscordAccessRole(env, request, body.value)
      : { ok: false as const, status: 400 as const, message: "Choose either the private invite or finish-access action." };
  return json(result, { status: result.status, headers });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
