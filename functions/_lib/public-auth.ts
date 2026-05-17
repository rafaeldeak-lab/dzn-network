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
