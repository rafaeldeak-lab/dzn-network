import { getPublicPlayerProfilePayload } from "../../../_lib/public-player-profile";
import { json, methodNotAllowed } from "../../../_lib/http";
import { hasPrivateRequestSignal, noStoreForErrorHeaders, privateNoStoreHeaders, publicCacheHeaders, withVaryToken } from "../../../_lib/performance";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const result = await getPublicPlayerProfilePayload(env, params.handle);
  const publicHeaders = withVaryToken(undefined, "Cookie");
  const headers = result.status >= 400
    ? noStoreForErrorHeaders()
    : hasPrivateRequestSignal(request)
      ? privateNoStoreHeaders()
      : publicCacheHeaders({ maxAge: 30, staleWhileRevalidate: 90 }, "MISS", publicHeaders);

  return json(result.payload, {
    status: result.status,
    headers,
  });
};
