import { ensureAutomationSchema, getAutomationContextForLinkedServer } from "../../../_lib/automation";
import { getSessionUser, requireDb } from "../../../_lib/db";
import { fetchDiscordPostingChannels } from "../../../_lib/discord-posting";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });
  const access = await requireOwnedServer(env, user.id, linkedServerId);
  if (!access) return json({ error: "Server not found" }, { status: 404 });

  const context = await getAutomationContextForLinkedServer(env, linkedServerId);
  if (!context) return json({ error: "Automation is not ready for this server yet." }, { status: 409 });

  await ensureAutomationSchema(env);

  if (isMockAuth(env.MOCK_AUTH)) {
    return json({
      channels: [
        mockChannel("123456789012345678", "auto-leaderboards", "Automation"),
        mockChannel("123456789012345679", "killfeed", "Feeds"),
        mockChannel("123456789012345680", "admin-alerts", "Admin", ["Embed Links"]),
      ],
      manual_fallback: false,
      fetched_at: new Date().toISOString(),
    });
  }

  try {
    const channels = await fetchDiscordPostingChannels(env, context.guildId);
    return json({
      channels,
      manual_fallback: false,
      fetched_at: new Date().toISOString(),
    });
  } catch {
    return json({
      channels: [],
      manual_fallback: true,
      warning: "DZN could not fetch Discord channels. Use Advanced manual setup with a channel ID and optional webhook fallback.",
      fetched_at: new Date().toISOString(),
    });
  }
};

async function requireOwnedServer(env: Env, userId: string, linkedServerId: string) {
  return requireDb(env)
    .prepare("SELECT id FROM linked_servers WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(linkedServerId, userId)
    .first<{ id: string }>();
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  return {
    id: "mock-user",
    discord_id: "mock-discord-user",
    username: "RafaelDeak",
    avatar: null,
  };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function mockChannel(channelId: string, channelName: string, categoryName: string, missingPermissions: string[] = []) {
  return {
    channel_id: channelId,
    channel_name: channelName,
    channel_type: "text",
    category_name: categoryName,
    can_view: !missingPermissions.includes("View Channel"),
    can_send: !missingPermissions.includes("Send Messages"),
    can_embed: !missingPermissions.includes("Embed Links"),
    can_read_history: !missingPermissions.includes("Read Message History"),
    can_manage_messages: !missingPermissions.includes("Manage Messages"),
    can_post: missingPermissions.length === 0,
    missing_permissions: missingPermissions,
  };
}
