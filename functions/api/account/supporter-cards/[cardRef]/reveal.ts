import {
  DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE,
  DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION,
  privateRevealErrorPayload,
  readDznStorePrivateSupporterCardReveal,
} from "../../../../_lib/dzn-store-supporter-card-reveal";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { getRequestSessionUser } from "../../../../_lib/owner-access";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) {
    return json(privateRevealErrorPayload(
      401,
      "Unauthorized",
      "Login with Discord before viewing a private DZN Supporter Card.",
    ), { status: 401, headers: privateRevealHeaders() });
  }

  const cardRef = typeof params.cardRef === "string" ? params.cardRef : "";
  const result = await readDznStorePrivateSupporterCardReveal(env, user, cardRef);
  return json(result.body, {
    status: result.status,
    headers: privateRevealHeaders(),
  });
};

function privateRevealHeaders() {
  return privateNoStoreHeaders({
    "x-dzn-store-supporter-card-reveal-route": DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE,
    "x-dzn-store-supporter-card-reveal-schema": DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION,
    "x-dzn-store-supporter-card-public-reveal": "blocked",
    "x-dzn-store-live-checkout": "disabled",
    "x-dzn-store-production-mutation": "none",
  });
}
