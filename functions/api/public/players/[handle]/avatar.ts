import { methodNotAllowed } from "../../../../_lib/http";
import { readPublicDiscordAvatarSource } from "../../../../_lib/player-public-profiles";
import type { PagesFunction } from "../../../../_lib/types";

const avatarHeaders = {
  "cache-control": "private, no-store, no-cache, must-revalidate",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  try {
    const source = await readPublicDiscordAvatarSource(env, params.handle);
    if (!source) return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });

    const discordResponse = await fetch(
      `https://cdn.discordapp.com/avatars/${encodeURIComponent(source.discord_id)}/${encodeURIComponent(source.avatar_hash)}.webp?size=256`,
      { headers: { accept: "image/webp,image/*" } },
    );
    const contentType = discordResponse.headers.get("content-type") ?? "";
    if (!discordResponse.ok || !discordResponse.body || !contentType.toLowerCase().startsWith("image/")) {
      return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
    }

    return new Response(discordResponse.body, {
      status: 200,
      headers: {
        ...avatarHeaders,
        "content-type": contentType,
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
};
