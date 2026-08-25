import { getSessionUser } from "./_lib/db";
import { redirect } from "./_lib/http";
import { requireActiveOwnerEntitlement } from "./_lib/owner-access";
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

const ownerBillingPagePrefixes = [
  "/dashboard",
  "/setup",
];

export const onRequest: PagesFunction = async ({ request, env, next }) => {
  const url = new URL(request.url);
  if (!isProtectedAppPagePath(url.pathname) || !isPageNavigationMethod(request.method)) {
    return next();
  }

  try {
    const user = await getSessionUser(env, request);
    if (user) {
      if (isOwnerBillingPagePath(url.pathname)) {
        const ownerAccess = await requireActiveOwnerEntitlement(env, user, `${url.pathname}${url.search}`);
        if (!ownerAccess.allowed) return redirect(ownerAccess.pricingUrl);
      }
      return next();
    }
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

export function isOwnerBillingPagePath(pathname: string) {
  return ownerBillingPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPageNavigationMethod(method: string) {
  return method === "GET" || method === "HEAD";
}
