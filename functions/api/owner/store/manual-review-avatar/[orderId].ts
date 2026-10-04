import { json, methodNotAllowed } from "../../../../_lib/http";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import { requirePlatformOwner } from "../../../../_lib/platform-owner";
import { readStoreManualReviewAvatarSource, storeManualReviewEnabled } from "../../../../_lib/store-manual-review";
import type { PagesFunction } from "../../../../_lib/types";

const ALLOWED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 1024 * 1024;

export const onRequestGet: PagesFunction = async ({ env, request, params }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return privateResponse(auth.response);
  if (!storeManualReviewEnabled(env)) return json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
  try {
    const source = await readStoreManualReviewAvatarSource(env, String(params.orderId ?? ""));
    if (!source) return json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
    const upstream = await fetch(source, {
      headers: { accept: "image/webp,image/png,image/jpeg,image/gif" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!upstream.ok || !upstream.body) return json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
    const contentType = (upstream.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const declaredLength = Number(upstream.headers.get("content-length") ?? "0");
    if (!ALLOWED_IMAGE_TYPES.has(contentType) || (declaredLength > 0 && declaredLength > MAX_AVATAR_BYTES)) {
      return json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
    }
    const image = await upstream.arrayBuffer();
    if (image.byteLength === 0 || image.byteLength > MAX_AVATAR_BYTES) {
      return json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: privateNoStoreHeaders() });
    }
    return new Response(request.method === "HEAD" ? null : image, {
      status: 200,
      headers: privateNoStoreHeaders({ "content-type": contentType, "content-length": String(image.byteLength) }),
    });
  } catch {
    return json({ ok: false, error: "AVATAR_UNAVAILABLE" }, { status: 503, headers: privateNoStoreHeaders() });
  }
};

export const onRequestHead = onRequestGet;
export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;

function privateResponse(response: Response) {
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: privateNoStoreHeaders(response.headers) });
}
