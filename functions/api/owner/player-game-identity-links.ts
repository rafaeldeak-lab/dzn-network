import { getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { readManagedGameIdentityLinks } from "../../_lib/player-game-identity-revocation";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  if (request.method !== "GET") return methodNotAllowed();
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, message: "Sign in to manage game stats links." }, { status: 401, headers });
  try {
    const result = await readManagedGameIdentityLinks(env, user, new URL(request.url).searchParams);
    return json(result, { status: result.ok ? 200 : result.status, headers });
  } catch {
    return json({ ok: false, message: "Game stats links are temporarily unavailable." }, { status: 503, headers });
  }
};
