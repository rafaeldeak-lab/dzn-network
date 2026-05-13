import { getSessionUser, requireDb } from "../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { fetchMockNitradoServices, fetchNitradoServices } from "../../_lib/nitrado";
import {
  findService,
  getLatestNitradoToken,
  linkLatestNitradoConnection,
  normalizeTags,
  publicSlug,
  validateServerType,
} from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

type SaveBody = {
  discordGuildId?: string;
  discordGuildDbId?: number;
  serverType?: string;
  tags?: string[];
  nitradoServiceId?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJson<SaveBody>(request);
  if (!body.discordGuildId || !body.nitradoServiceId || !body.serverType) {
    return json({ error: "Missing onboarding fields" }, { status: 400 });
  }
  if (!validateServerType(body.serverType)) {
    return json({ error: "Invalid server type" }, { status: 400 });
  }

  const userId = user?.id ?? 1;
  const db = requireDb(env);
  const guild = await db
    .prepare("SELECT id, guild_id, name FROM discord_guilds WHERE guild_id = ? AND owner_user_id = ? LIMIT 1")
    .bind(body.discordGuildId, userId)
    .first<{ id: number; guild_id: string; name: string }>();
  if (!guild) return json({ error: "Discord guild not found" }, { status: 400 });

  const services = isMockNitrado(env.MOCK_NITRADO)
    ? await fetchMockNitradoServices()
    : await fetchNitradoServices((await getLatestNitradoToken(env, userId)) ?? "");
  const service = findService(services, body.nitradoServiceId);
  if (!service) return json({ error: "DayZ Nitrado service not found" }, { status: 400 });

  const tags = normalizeTags(body.tags);
  const existing = await db
    .prepare("SELECT id FROM linked_servers WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1")
    .bind(userId)
    .first<{ id: number }>();

  let linkedServerId: number;
  if (existing) {
    linkedServerId = existing.id;
    await db
      .prepare(
        `UPDATE linked_servers SET
          guild_id = ?,
          discord_guild_id = ?,
          nitrado_service_id = ?,
          nitrado_service_name = ?,
          server_name = ?,
          server_type = ?,
          tags_json = ?,
          region = ?,
          status = 'Pending',
          public_slug = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      )
      .bind(
        guild.guild_id,
        guild.id,
        service.id,
        service.name,
        service.name,
        body.serverType,
        JSON.stringify(tags),
        service.region ?? null,
        publicSlug(service.name),
        linkedServerId,
      )
      .run();
  } else {
    const inserted = await db
      .prepare(
        `INSERT INTO linked_servers (
          user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name,
          server_name, server_type, tags_json, region, status, public_slug, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id`,
      )
      .bind(
        userId,
        guild.guild_id,
        guild.id,
        service.id,
        service.name,
        service.name,
        body.serverType,
        JSON.stringify(tags),
        service.region ?? null,
        publicSlug(service.name),
      )
      .first<{ id: number }>();
    if (!inserted) throw new Error("Failed to save linked server");
    linkedServerId = inserted.id;
  }

  await linkLatestNitradoConnection(env, userId, linkedServerId);
  return json({ ok: true, linkedServerId });
};
