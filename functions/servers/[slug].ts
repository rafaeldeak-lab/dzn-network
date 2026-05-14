import { secureHeaders } from "../_lib/http";
import type { PagesFunction } from "../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, next }) => {
  if (!env.ASSETS) return next();

  const url = new URL(request.url);
  const shellUrl = new URL("/servers/index.html", url.origin);
  const shellRequest = new Request(shellUrl.toString(), request);
  const shellResponse = await env.ASSETS.fetch(shellRequest);

  if (!shellResponse.ok) return next();

  const headers = secureHeaders(shellResponse.headers);
  headers.set("cache-control", "no-store");

  return new Response(shellResponse.body, {
    status: 200,
    headers,
  });
};
