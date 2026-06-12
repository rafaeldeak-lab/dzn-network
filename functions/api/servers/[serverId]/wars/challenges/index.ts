import { getSessionUser } from "../../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { createServerWarChallenge } from "../../../../../_lib/server-wars";
import type { PagesFunction } from "../../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const serverId = sanitizeParam(params.serverId);
  if (!serverId) return json({ ok: false, error: "invalid_server_id" }, { status: 400 });
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "unauthenticated" }, { status: 401 });
  const body = await readJson<Record<string, unknown>>(request);
  const result = await createServerWarChallenge(env, user, serverId, body);
  if (!result.ok) {
    return json({
      ok: false,
      error: result.error,
      message: "message" in result ? result.message : undefined,
      access: "access" in result ? result.access : undefined,
    }, { status: result.status });
  }
  return json(result, { status: 201 });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

function sanitizeParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim().slice(0, 96) : "";
}
