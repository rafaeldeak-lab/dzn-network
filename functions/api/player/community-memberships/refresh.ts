import { MOCK_USER_ID, getSessionUser, requireDb } from "../../../_lib/db";
import { DiscordRequestError, fetchDiscordGuilds } from "../../../_lib/discord";
import { getUsableDiscordAccessToken } from "../../../_lib/discord-oauth";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isMockAuth, mockGuilds, mockUser } from "../../../_lib/mock";
import { storePlayerDiscordCommunityMemberships } from "../../../_lib/player-community-memberships";
import { privateNoStoreHeaders } from "../../../_lib/performance";
import type { DiscordGuild, Env, PagesFunction, SessionUser } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  if (!isSameOriginMutation(request)) {
    return json(
      { ok: false, error: "FORBIDDEN", message: "Cross-origin Discord membership refreshes are not allowed." },
      { status: 403, headers: privateNoStoreHeaders() },
    );
  }

  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to refresh Player Hub community matches.", requires_relogin: true },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }

  let guilds: DiscordGuild[];
  try {
    guilds = await readCurrentUserDiscordGuilds(env, user.id);
  } catch (error) {
    const requiresRelogin = isDiscordAuthorizationFailure(error);
    return json(
      {
        ok: false,
        error: requiresRelogin ? "DISCORD_RECONNECT_REQUIRED" : "DISCORD_REFRESH_FAILED",
        message: requiresRelogin
          ? "Discord community access needs refreshing. Log out and back in with Discord, then try again."
          : "Discord community matching could not be refreshed right now. Try again later.",
        requires_relogin: requiresRelogin,
      },
      { status: requiresRelogin ? 401 : 502, headers: privateNoStoreHeaders() },
    );
  }

  await storePlayerDiscordCommunityMemberships(env, user.id, guilds);

  return json(
    {
      ok: true,
      refreshed_at: new Date().toISOString(),
      source: "player_discord_community_memberships",
      message: "Discord community matching was refreshed for your private Player Hub.",
      private: true,
      presentation_only: true,
    },
    { headers: privateNoStoreHeaders() },
  );
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  return ensureMockPlayerUser(env);
}

async function ensureMockPlayerUser(env: Env): Promise<SessionUser> {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO users (id, discord_id, username, avatar, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         discord_id = excluded.discord_id,
         username = excluded.username,
         avatar = excluded.avatar,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(MOCK_USER_ID, mockUser.id, mockUser.username, mockUser.avatar)
    .run();

  return {
    id: MOCK_USER_ID,
    discord_id: mockUser.id,
    username: mockUser.username,
    avatar: mockUser.avatar,
  };
}

async function readCurrentUserDiscordGuilds(env: Env, userId: string) {
  if (isMockAuth(env.MOCK_AUTH)) return mockGuilds;

  const accessToken = await getUsableDiscordAccessToken(env, userId);
  if (!accessToken) throw new DiscordRequestError("guilds_fetch", 401, "missing_or_expired_token");

  return fetchDiscordGuilds(accessToken);
}

function isDiscordAuthorizationFailure(error: unknown) {
  return error instanceof DiscordRequestError && (error.status === 401 || error.status === 403);
}

function isSameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
