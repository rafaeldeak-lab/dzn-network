import { createSession, SESSION_COOKIE, storeGuilds, upsertUser } from "../../../_lib/db";
import {
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  filterAdminGuilds,
} from "../../../_lib/discord";
import { readCookie, redirect, setCookie } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, "dzn_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirect("/login?error=discord_state");
  }

  try {
    const token = await exchangeDiscordCode(env, code);
    const [user, guilds] = await Promise.all([
      fetchDiscordUser(token.access_token),
      fetchDiscordGuilds(token.access_token),
    ]);
    const userId = await upsertUser(env, user);
    await storeGuilds(env, userId, filterAdminGuilds(guilds));
    const session = await createSession(env, userId);

    const headers = new Headers({ location: "/setup", "cache-control": "no-store" });
    headers.append("set-cookie", setCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }));
    headers.append("set-cookie", setCookie("dzn_oauth_state", "", { maxAge: 0 }));
    return new Response(null, { status: 302, headers });
  } catch {
    return redirect("/login?error=discord_callback");
  }
};
