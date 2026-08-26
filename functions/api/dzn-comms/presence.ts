import {
  D1DznCommsPresenceStorage,
  DZN_COMMS_PRESENCE_COOKIE_NAME,
  normalizeDznCommsPresenceScope,
  readDznCommsPresence,
  refreshDznCommsPresence,
} from "../../_lib/dzn-comms-presence";
import { json, methodNotAllowed, readBoundedJson, readCookie } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

type PresenceBody = {
  scope?: unknown;
};

const BODY_LIMIT_BYTES = 512;

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const payload = await readDznCommsPresence({
    env,
    storage: env.DB ? new D1DznCommsPresenceStorage(env.DB) : null,
    rawScope: url.searchParams.get("scope"),
  });

  return json(payload, { headers: presenceResponseHeaders() });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const body = await readBoundedJson<PresenceBody>(request, BODY_LIMIT_BYTES);
  if (!body.ok) {
    return json({ ok: false, error: body.error, message: body.message }, {
      status: body.status,
      headers: presenceResponseHeaders(),
    });
  }

  const url = new URL(request.url);
  const scope = normalizeDznCommsPresenceScope(body.value.scope ?? url.searchParams.get("scope"));
  const heartbeat = await refreshDznCommsPresence({
    env,
    storage: env.DB ? new D1DznCommsPresenceStorage(env.DB) : null,
    rawScope: scope,
    existingSessionKey: readCookie(request, DZN_COMMS_PRESENCE_COOKIE_NAME),
    secureCookie: url.protocol === "https:",
  });
  const headers = presenceResponseHeaders();
  if (heartbeat.setCookieHeader) headers.set("set-cookie", heartbeat.setCookieHeader);

  return json(heartbeat.payload, { status: heartbeat.wrote ? 200 : 202, headers });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;

function presenceResponseHeaders() {
  const headers = new Headers();
  headers.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  headers.set("x-dzn-presence-contract", "aggregate-only");
  return headers;
}
