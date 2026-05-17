import { ensureMockUser, getSessionUser } from "../../../_lib/db";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { refreshNitradoServerMetadata } from "../../../_lib/server-metadata";
import {
  getAutomationContextForLinkedServer,
  queueDiscordPostUpdatesForGuild,
  recordStatusCheckResult,
  upsertServerPublicCache,
} from "../../../_lib/automation";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  try {
    const result = await refreshNitradoServerMetadata(env, {
      linkedServerId,
      userId: user.id,
      force: true,
    });
    const context = await getAutomationContextForLinkedServer(env, linkedServerId);
    if (context) {
      await recordStatusCheckResult(env, {
        guildId: context.guildId,
        planKey: context.planKey,
        ok: result.ok,
        currentPlayers: typeof result.metadata?.current_players === "number" ? result.metadata.current_players : null,
        maxPlayers: typeof result.metadata?.max_players === "number" ? result.metadata.max_players : null,
        serverOnline: metadataOnlineValue(result.metadata),
        serverStatus: result.metadata?.server_status ?? null,
        error: result.ok ? null : result.message,
      });
      await upsertServerPublicCache(env, {
        guildId: context.guildId,
        planKey: context.planKey,
        publicServerName: result.metadata?.display_name ?? null,
        currentPlayers: typeof result.metadata?.current_players === "number" ? result.metadata.current_players : null,
        maxPlayers: typeof result.metadata?.max_players === "number" ? result.metadata.max_players : null,
        serverOnline: metadataOnlineValue(result.metadata),
        serverStatus: result.metadata?.server_status ?? null,
        lastStatusUpdateAt: result.player_count_last_checked_at ?? result.metadata_last_checked_at ?? null,
      });
      if (result.changed) {
        await queueDiscordPostUpdatesForGuild(env, context.guildId, context.planKey, ["basic_status_embed", "priority_status_embed"], "manual-status-refresh");
      }
    }
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to refresh server metadata" }, { status: 400 });
  }
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function metadataOnlineValue(value: unknown) {
  return value && typeof value === "object" && "is_online" in value
    ? (value as { is_online?: boolean | number | null }).is_online ?? null
    : null;
}
