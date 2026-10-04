import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import {
  listStoreManualReviewOrders,
  recordStoreManualReviewAction,
  storeManualReviewEnabled,
} from "../../../_lib/store-manual-review";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return privateResponse(auth.response);
  if (!storeManualReviewEnabled(env)) return disabled();
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const result = await listStoreManualReviewOrders(env, {
    cursor: url.searchParams.get("cursor"),
    limit: rawLimit === null ? undefined : Number(rawLimit),
    mode: url.searchParams.get("mode"),
    query: url.searchParams.get("q"),
  });
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return privateResponse(auth.response);
  if (!sameOrigin(request)) return json({ ok: false, error: "FORBIDDEN", message: "Cross-origin Store review actions are not allowed." }, { status: 403, headers: privateNoStoreHeaders() });
  if (!storeManualReviewEnabled(env)) return disabled();
  const body = await readBoundedJson(request, 4 * 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await recordStoreManualReviewAction(env, auth.user, body.value);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;

function disabled() {
  return json({ ok: false, error: "STORE_REVIEW_DISABLED" }, { status: 404, headers: privateNoStoreHeaders() });
}

function privateResponse(response: Response) {
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: privateNoStoreHeaders(response.headers) });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
