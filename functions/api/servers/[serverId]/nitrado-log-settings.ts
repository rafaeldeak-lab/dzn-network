import { getSessionUser, requireDb } from "../../../_lib/db";
import {
  getNitradoLogSettingsConfirmation,
  updateNitradoLogSettingsConfirmation,
} from "../../../_lib/automation";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type SaveNitradoLogSettingsBody = {
  nitrado_reduce_log_output_confirmed?: boolean;
  nitrado_log_playerlist_confirmed?: boolean;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const server = await requireOwnedServer(env, user.id, linkedServerId);
  if (!server) return json({ error: "Server not found" }, { status: 404 });
  if (!server.guild_id) return json({ error: "Selected server has no Discord guild id." }, { status: 409 });

  if (request.method === "GET") {
    return json({
      ok: true,
      settings: await getNitradoLogSettingsConfirmation(env, server.guild_id),
    });
  }
  if (request.method !== "POST") return methodNotAllowed();

  const body = await readJson<SaveNitradoLogSettingsBody>(request);
  const settings = await updateNitradoLogSettingsConfirmation(env, {
    guildId: server.guild_id,
    reduceLogOutputConfirmed: body.nitrado_reduce_log_output_confirmed === true,
    logPlayerlistConfirmed: body.nitrado_log_playerlist_confirmed === true,
  });
  return json({ ok: true, settings });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const { ensureMockUser } = await import("../../../_lib/db");
  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

async function requireOwnedServer(env: Env, userId: string, linkedServerId: string) {
  return requireDb(env)
    .prepare(
      `SELECT id, guild_id
       FROM linked_servers
       WHERE id = ?
         AND user_id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(linkedServerId, userId)
    .first<{ id: string; guild_id: string | null }>();
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}
