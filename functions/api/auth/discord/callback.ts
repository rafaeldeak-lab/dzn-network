import { createSession, SESSION_COOKIE, storeDiscordOAuthToken, storeGuilds, upsertUser } from "../../../_lib/db";
import {
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  filterAdminGuilds,
} from "../../../_lib/discord";
import { methodNotAllowed, readCookie, redirect, secureHeaders, setCookie } from "../../../_lib/http";
import { isValidOAuthState, OAUTH_RETURN_COOKIE, OAUTH_STATE_COOKIE, safeReturnTo } from "../../../_lib/oauth";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const returnTo = safeReturnTo(readCookie(request, OAUTH_RETURN_COOKIE));

  if (!code || !isValidOAuthState(state) || !isValidOAuthState(expectedState) || state !== expectedState) {
    const headers = new Headers();
    headers.append("set-cookie", setCookie(OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    headers.append("set-cookie", setCookie(OAUTH_RETURN_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    return redirect("/login?error=discord_state", headers);
  }

  try {
    const token = await exchangeDiscordCode(env, code);
    const [user, guilds] = await Promise.all([
      fetchDiscordUser(token.access_token),
      fetchDiscordGuilds(token.access_token),
    ]);
    const userId = await upsertUser(env, user);
    await storeDiscordOAuthToken(env, userId, token);
    await storeGuilds(env, userId, filterAdminGuilds(guilds));
    const session = await createSession(env, userId);

    const headers = secureHeaders({ location: returnTo, "cache-control": "no-store" });
    headers.append("set-cookie", setCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }));
    headers.append("set-cookie", setCookie(OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    headers.append("set-cookie", setCookie(OAUTH_RETURN_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    return new Response(null, { status: 302, headers });
  } catch {
    const headers = new Headers();
    headers.append("set-cookie", setCookie(OAUTH_STATE_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    headers.append("set-cookie", setCookie(OAUTH_RETURN_COOKIE, "", {
      maxAge: 0,
      path: "/api/auth/discord/callback",
    }));
    return redirect("/login?error=discord_callback", headers);
  }
};
