import { createSession, ensureMockUser, SESSION_COOKIE } from "../../../_lib/db";
import { buildDiscordAuthorizeUrl } from "../../../_lib/discord";
import { methodNotAllowed, redirect, setCookie } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { createOAuthState, OAUTH_STATE_COOKIE } from "../../../_lib/oauth";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  if (isMockAuth(env.MOCK_AUTH)) {
    const { userId } = await ensureMockUser(env);
    const session = await createSession(env, userId);
    return redirect("/setup", {
      "set-cookie": setCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }),
    });
  }

  const state = createOAuthState();
  let destination: URL;

  try {
    destination = new URL(buildDiscordAuthorizeUrl(env, state));
  } catch {
    return redirect("/login?error=discord_authorize");
  }

  if (destination.origin !== "https://discord.com" || destination.pathname !== "/oauth2/authorize") {
    return redirect("/login?error=discord_authorize");
  }

  return redirect(destination.toString(), {
    "set-cookie": setCookie(OAUTH_STATE_COOKIE, state, {
      maxAge: 60 * 10,
      httpOnly: true,
      path: "/api/auth/discord/callback",
      sameSite: "Lax",
    }),
  });
};
