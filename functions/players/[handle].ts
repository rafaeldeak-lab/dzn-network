import { secureHeaders } from "../_lib/http";
import { readPublicPlayerProfileByHandle } from "../_lib/player-public-profiles";
import {
  buildPublicProfileSocialMetadata,
  injectPublicProfileSocialMetadata,
  withoutContentLength,
} from "../_lib/public-profile-social-metadata";
import type { PagesFunction } from "../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, next, params }) => {
  if (!env.ASSETS) return next();

  const url = new URL(request.url);
  const shellUrl = new URL("/players", url.origin);
  const shellRequest = new Request(shellUrl.toString(), request);
  const shellResponse = await env.ASSETS.fetch(shellRequest);

  if (!shellResponse.ok) return next();

  const headers = secureHeaders(withoutContentLength(shellResponse.headers));
  headers.set("cache-control", "no-store");
  headers.set("content-type", "text/html; charset=utf-8");

  const profile = await readPublicPlayerProfileByHandle(env, params.handle).catch(() => null);
  const metadata = buildPublicProfileSocialMetadata(request.url, profile);
  const html = injectPublicProfileSocialMetadata(await shellResponse.text(), metadata);

  return new Response(html, {
    status: 200,
    headers,
  });
};
