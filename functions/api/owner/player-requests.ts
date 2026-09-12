import { requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { privateNoStoreHeaders } from "../../_lib/performance";
import { requirePlatformOwner } from "../../_lib/platform-owner";
import { readPlayerRequestSupport } from "../../_lib/player-request-support";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  if (request.method !== "GET") return methodNotAllowed();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) {
    const response = new Response(auth.response.body, auth.response);
    new Headers(headers).forEach((value, key) => response.headers.set(key, value));
    return response;
  }
  try {
    const result = await readPlayerRequestSupport(requireDb(env), new URL(request.url).searchParams);
    return json(result, { status: result.ok ? 200 : result.status, headers });
  } catch {
    return json({ ok: false, message: "Player request history is temporarily unavailable." }, { status: 503, headers });
  }
};
