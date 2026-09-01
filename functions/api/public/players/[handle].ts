import { json, methodNotAllowed } from "../../../_lib/http";
import { noStoreForErrorHeaders, publicCacheHeaders } from "../../../_lib/performance";
import { readPublicPlayerProfileByHandle } from "../../../_lib/player-public-profiles";
import type { PagesFunction } from "../../../_lib/types";

const publicProfileHeaders = publicCacheHeaders({ maxAge: 15, staleWhileRevalidate: 45 });

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  try {
    const profile = await readPublicPlayerProfileByHandle(env, params.handle);
    if (!profile) {
      return json(
        {
          ok: false,
          error: "PROFILE_NOT_FOUND",
          message: "This public player profile is not available.",
        },
        { status: 404, headers: noStoreForErrorHeaders({ vary: "Cookie" }) },
      );
    }

    return json(profile, { headers: publicProfileHeaders });
  } catch {
    return json(
      {
        ok: false,
        error: "PROFILE_UNAVAILABLE",
        message: "Public player profiles are unavailable right now.",
      },
      { status: 503, headers: noStoreForErrorHeaders({ vary: "Cookie" }) },
    );
  }
};
