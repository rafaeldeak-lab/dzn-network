import { discoverOwnerDiscordDeliveryCandidates } from "../../../_lib/owner-discord-delivery-discovery";
import { json, methodNotAllowed } from "../../../_lib/http";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const headers = privateNoStoreHeaders();
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return withHeaders(auth.response, headers);
  const url = new URL(request.url);
  const guildId = url.searchParams.get("guild_id") ?? url.searchParams.get("guildId");
  return json(await discoverOwnerDiscordDeliveryCandidates(env, guildId), { headers });
};

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;

function withHeaders(response: Response, headers: Headers) {
  const next = new Headers(response.headers);
  headers.forEach((value, key) => next.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: next });
}
