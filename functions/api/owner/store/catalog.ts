import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import {
  createStoreCatalogDraft,
  listStoreCatalogDrafts,
  storeDraftAdminEnabled,
} from "../../../_lib/store-catalog-admin";
import type { PagesFunction } from "../../../_lib/types";

const responseBoundary = {
  storeActive: false,
  publicCatalogEnabled: false,
  checkoutEnabled: false,
  paymentsEnabled: false,
  fulfilmentEnabled: false,
} as const;

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return privateResponse(auth.response);
  if (!storeDraftAdminEnabled(env)) return disabled();

  const result = await listStoreCatalogDrafts(env);
  return json({ ...result, ...responseBoundary }, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return privateResponse(auth.response);
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "FORBIDDEN", message: "Cross-origin Store draft requests are not allowed." }, {
      status: 403,
      headers: privateNoStoreHeaders(),
    });
  }
  if (!storeDraftAdminEnabled(env)) return disabled();

  const body = await readBoundedJson<{ product?: unknown; price?: unknown }>(request, 16 * 1024);
  if (!body.ok) return json({ ok: false, error: body.error, message: body.message }, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await createStoreCatalogDraft(env, auth.user, body.value);
  return json({ ...result, ...responseBoundary }, { status: result.status, headers: privateNoStoreHeaders() });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;

function disabled() {
  return json({ ok: false, error: "STORE_DRAFT_ADMIN_DISABLED", ...responseBoundary }, {
    status: 404,
    headers: privateNoStoreHeaders(),
  });
}

function privateResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: privateNoStoreHeaders(response.headers),
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
