import { getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { dispatchQueuedPlayerGameIdentityNotifications } from "../../../_lib/player-game-identity-notifications";
import { revokePlayerGameIdentityLink } from "../../../_lib/player-game-identity-revocation";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request, params, waitUntil }) => {
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
  if (result.ok && result.delivery_id) {
    waitUntil(dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId: result.delivery_id, maxJobs: 1 }));
  }
  const publicResult = { ...result } as typeof result & { delivery_id?: string | null };
  delete publicResult.delivery_id;
  return json(publicResult, { status: result.status, headers });
};
