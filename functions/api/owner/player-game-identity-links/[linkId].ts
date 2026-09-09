import { getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { revokePlayerGameIdentityLink } from "../../../_lib/player-game-identity-revocation";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request, params }) => {
  const headers = privateNoStoreHeaders();
  if (request.method !== "PATCH") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, message: "Sign in to manage game stats links." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ ok: false, message: "Use the signed-in DZN website to revoke a link." }, { status: 403, headers });
  }
  const body = await readBoundedJson<unknown>(request, 4096);
  if (!body.ok) return json(body, { status: body.status, headers });
  const id = typeof params.linkId === "string" ? params.linkId : "";
  const result = await revokePlayerGameIdentityLink(env, user, id, body.value);
  return json(result, { status: result.status, headers });
};
