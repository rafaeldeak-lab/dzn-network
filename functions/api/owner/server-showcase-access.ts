import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { requirePlatformOwner } from "../../_lib/platform-owner";
import { NUKETOWN_SHOWCASE_SCOPE } from "../../_lib/server-showcase-access";
import { changeShowcaseGrant, readShowcaseGrantSupport } from "../../_lib/server-showcase-grants";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  try {
    if (request.method === "GET") {
      const before = new URL(request.url).searchParams.get("before");
      const result = await readShowcaseGrantSupport(env, auth.user, before === null ? null : Number(before));
      return json(result.payload, { status: result.status });
    }
    if (request.headers.get("origin") !== new URL(request.url).origin
      || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ ok: false, error: "SAME_ORIGIN_REQUIRED" }, { status: 403 });
    }
    const body = await readBoundedJson<Record<string, unknown>>(request, 2048);
    if (!body.ok) return json({ ok: false, error: body.error }, { status: body.status });
    const input = body.value;
    if (!input || Array.isArray(input) || typeof input !== "object"
      || input.confirmation !== `${input.action}:${NUKETOWN_SHOWCASE_SCOPE.linkedServerId}`) {
      return json({ ok: false, error: "EXACT_SERVER_CONFIRMATION_REQUIRED" }, { status: 400 });
    }
    if (input.action !== "grant" && input.action !== "revoke") {
      return json({ ok: false, error: "INVALID_SHOWCASE_ACTION" }, { status: 400 });
    }
    if (input.action === "grant") {
      const result = await changeShowcaseGrant(env, auth.user, { action: "grant", requestId: String(input.requestId ?? "") });
      return json(result.payload, { status: result.status });
    }
    if (input.reason !== "owner_request" && input.reason !== "support_correction") {
      return json({ ok: false, error: "REVOCATION_REASON_REQUIRED" }, { status: 400 });
    }
    const result = await changeShowcaseGrant(env, auth.user, { action: "revoke", grantId: String(input.grantId ?? ""), reason: input.reason });
    return json(result.payload, { status: result.status });
  } catch {
    return json({ ok: false, error: "SHOWCASE_ACCESS_UNAVAILABLE" }, { status: 503 });
  }
};
