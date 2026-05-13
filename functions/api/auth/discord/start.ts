import { createSession, ensureMockUser, SESSION_COOKIE } from "../../../_lib/db";
import { buildDiscordAuthorizeUrl } from "../../../_lib/discord";
import { redirect, setCookie } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { randomToken } from "../../../_lib/crypto";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (isMockAuth(env.MOCK_AUTH)) {
    const { userId } = await ensureMockUser(env);
    const session = await createSession(env, userId);
    return redirect("/setup", {
      "set-cookie": setCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }),
    });
  }

  const state = randomToken(24);
  return redirect(buildDiscordAuthorizeUrl(env, state), {
    "set-cookie": setCookie("dzn_oauth_state", state, {
      maxAge: 60 * 10,
      httpOnly: true,
    }),
  });
};
