import { createSession, ensureMockUser, SESSION_COOKIE } from "../../../_lib/db";
import { methodNotAllowed, redirect, setCookie } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { safeReturnTo } from "../../../_lib/oauth";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  if (!isMockAuth(env.MOCK_AUTH)) {
    return redirect("/login?error=mock_disabled");
  }

  const { userId } = await ensureMockUser(env);
  const session = await createSession(env, userId);

  return redirect(returnTo, {
    "set-cookie": setCookie(SESSION_COOKIE, session.token, { maxAge: session.maxAge }),
  });
};
