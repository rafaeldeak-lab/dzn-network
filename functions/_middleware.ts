import { getSessionUser } from "./_lib/db";
import { redirect } from "./_lib/http";
import type { PagesFunction } from "./_lib/types";

const protectedAppPagePrefixes = [
  "/dashboard",
  "/dzn-pulse",
  "/events",
  "/leaderboards",
  "/seasons",
  "/servers",
  "/setup",
  "/test",
];

export const onRequest: PagesFunction = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (!isProtectedAppPagePath(url.pathname) || !isPageNavigationMethod(request.method)) {
    return next();
  }

  try {
    const user = await getSessionUser(env, request);
    if (user) return next();
  } catch {
    // Treat unreadable/invalid session state as logged out for page navigation.
  }

  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("returnTo", `${url.pathname}${url.search}`);
  return redirect(`${loginUrl.pathname}${loginUrl.search}`);
};

export function isProtectedAppPagePath(pathname: string) {
  return protectedAppPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPageNavigationMethod(method: string) {
  return method === "GET" || method === "HEAD";
}
