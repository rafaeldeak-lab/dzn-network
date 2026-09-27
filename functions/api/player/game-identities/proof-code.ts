import { getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../_lib/http";
import { redeemPlayerGameIdentityProofCode } from "../../../_lib/player-game-identity-proof-codes";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "UNAUTHORIZED", message: "Log in to use a proof code." }, { status: 401, headers: privateNoStoreHeaders() });
  if (!sameOrigin(request)) return json({ ok: false, error: "FORBIDDEN", message: "Cross-origin proof-code requests are not allowed." }, { status: 403, headers: privateNoStoreHeaders() });
  const body = await readBoundedJson<{ claim_id?: unknown; proof_code?: unknown }>(request, 1024);
  if (!body.ok) return json(body, { status: body.status, headers: privateNoStoreHeaders() });
  const result = await redeemPlayerGameIdentityProofCode(env, user, body.value);
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
