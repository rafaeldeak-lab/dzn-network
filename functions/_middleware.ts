import { getSessionUser } from "./_lib/db";
import { redirect } from "./_lib/http";
import type { PagesFunction } from "./_lib/types";

const protectedAppPagePrefixes = [
  "/dashboard",
  "/dzn-pulse",
  "/events",
  "/player",
  "/seasons",
  "/setup",
  "/test",
];

const legacyPageRedirects: Record<string, string> = {
  "/player-hub": "/player",
};

export const onRequest: PagesFunction = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (isManagedPagesPreviewHost(url.hostname)) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const legacyRedirectPath = legacyPageRedirects[url.pathname];
  if (legacyRedirectPath && isPageNavigationMethod(request.method)) {
    const target = new URL(legacyRedirectPath, url.origin);
    target.search = url.search;
    return redirect(`${target.pathname}${target.search}`);
  }
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

export function isManagedPagesPreviewHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return host !== "dzn-network.pages.dev" && host.endsWith(".dzn-network.pages.dev");
}

function isPageNavigationMethod(method: string) {
  return method === "GET" || method === "HEAD";
}
