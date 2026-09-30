import { secureHeaders } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, next }) => {
  if (!env.ASSETS) return next();
  const shell = await env.ASSETS.fetch(new Request(new URL("/servers/preview/community", request.url), request));
  if (!shell.ok) return next();
  const headers = secureHeaders(shell.headers);
  headers.set("cache-control", "no-store");
  return new Response(shell.body, { status: 200, headers });
};
