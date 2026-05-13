import { ensureMockUser, getSessionUser, requireDb } from "../../_lib/db";
import { guildIconUrl } from "../../_lib/discord";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, mockGuilds } from "../../_lib/mock";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  let user = await getSessionUser(env, request);
  if (!user && isMockAuth(env.MOCK_AUTH)) {
    const mock = await ensureMockUser(env);
    user = {
      id: mock.userId,
      discord_id: mock.user.id,
      username: mock.user.username,
      avatar: mock.user.avatar,
    };
  }

  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  if (isMockAuth(env.MOCK_AUTH)) {
    return json({
      guilds: mockGuilds.map((guild) => ({
        guild_id: guild.id,
        name: guild.name,
        icon: guild.icon,
        icon_url: guildIconUrl(guild),
        owner: guild.owner,
        permissions: guild.permissions,
      })),
    });
  }

  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT guild_id, name, icon, icon_url, permissions, is_owner
       FROM discord_guilds
       WHERE owner_user_id = ?
       ORDER BY name ASC`,
    )
    .bind(user.id)
    .all();

  return json({
    guilds: (result.results ?? []).map((guild) => ({
      ...guild,
      owner: Boolean(guild.is_owner),
    })),
  });
};
