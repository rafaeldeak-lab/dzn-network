import { getSessionUser } from "./db";
import type { Env, SessionUser } from "./types";

export async function getOptionalDiscordUser(request: Request, env: Env): Promise<SessionUser | null> {
  try {
    return await getSessionUser(env, request);
  } catch {
    return null;
  }
}

export async function isPublicViewerLoggedIn(request: Request, env: Env) {
  return Boolean(await getOptionalDiscordUser(request, env));
}

export function publicAccessCacheHeaders(viewerLoggedIn: boolean) {
  return viewerLoggedIn
    ? {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      }
    : {
        "cache-control": "public, max-age=15, stale-while-revalidate=45",
        vary: "Cookie",
      };
}

export function publicApiErrorHeaders() {
  return {
    "cache-control": "no-store, no-cache, must-revalidate",
    pragma: "no-cache",
    expires: "0",
    vary: "Cookie",
  };
}
