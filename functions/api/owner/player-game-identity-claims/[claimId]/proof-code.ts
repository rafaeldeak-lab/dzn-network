import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { issuePlayerGameIdentityProofCode } from "../../../../_lib/player-game-identity-proof-codes";
import { privateNoStoreHeaders } from "../../../../_lib/performance";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "UNAUTHORIZED", message: "Log in to issue a proof code." }, { status: 401, headers: privateNoStoreHeaders() });
  if (!sameOrigin(request)) return json({ ok: false, error: "FORBIDDEN", message: "Cross-origin proof-code requests are not allowed." }, { status: 403, headers: privateNoStoreHeaders() });
  const claimId = Array.isArray(params.claimId) ? params.claimId[0] : params.claimId;
  const result = await issuePlayerGameIdentityProofCode(env, user, claimId ?? "");
  return json(result, { status: result.status, headers: privateNoStoreHeaders() });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
