import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import { publishStoreProduct } from "../../../_lib/store-commerce";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  if (!sameOrigin(request)) return json({ ok: false, error: "FORBIDDEN" }, { status: 403, headers: privateNoStoreHeaders() });
  const body = await readBoundedJson<Record<string, unknown>>(request, 8 * 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await publishStoreProduct(env, auth.user, body.value);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
