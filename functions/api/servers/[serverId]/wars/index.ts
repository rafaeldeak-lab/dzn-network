import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { getOwnerServerWarsPayload } from "../../../../_lib/server-wars";
import type { PagesFunction } from "../../../../_lib/types";

const PRIVATE_HEADERS = { "cache-control": "private, max-age=20" };

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const serverId = sanitizeParam(params.serverId);
  if (!serverId) return json({ ok: false, error: "invalid_server_id" }, { status: 400 });
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const payload = await getOwnerServerWarsPayload(env, user, serverId);
  if (!payload.ok) return json({ ok: false, error: payload.error }, { status: payload.status });
  return json(payload, { headers: PRIVATE_HEADERS });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 96) : "";
}
