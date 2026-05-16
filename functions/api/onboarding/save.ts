import { ensureLinkedServerMetadataColumns, getSessionUser, requireDb } from "../../_lib/db";
import { geolocateServerIp, normalizeIp } from "../../_lib/geoip";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { fetchMockNitradoServices, fetchNitradoServices } from "../../_lib/nitrado";
import {
  countLinkedServersForUser,
  findService,
  getServerLinkLimitForUser,
  getLatestNitradoToken,
  linkLatestNitradoConnection,
  normalizeTags,
  uniquePublicSlug,
  validateServerType,
} from "../../_lib/onboarding";
import type { PagesFunction } from "../../_lib/types";

type SaveBody = {
  discordGuildId?: string;
  serverType?: string;
  tags?: string[];
  nitradoServiceId?: string;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const body = await readJson<SaveBody>(request);
  if (!body.discordGuildId || !body.nitradoServiceId || !body.serverType) {
    return json({ error: "Missing onboarding fields" }, { status: 400 });
  }
  if (!validateServerType(body.serverType)) {
    return json({ error: "Invalid server type" }, { status: 400 });
  }

  const userId = user.id;
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  const guild = await db
    .prepare("SELECT id, guild_id, name FROM discord_guilds WHERE guild_id = ? AND owner_user_id = ? LIMIT 1")
    .bind(body.discordGuildId, userId)
    .first<{ id: string; guild_id: string; name: string }>();
  if (!guild) return json({ error: "Discord guild not found" }, { status: 400 });

  const services = isMockNitrado(env.MOCK_NITRADO)
    ? await fetchMockNitradoServices()
    : await fetchNitradoServices((await getLatestNitradoToken(env, userId)) ?? "");
  const service = findService(services, body.nitradoServiceId);
  if (!service) return json({ error: "DayZ Nitrado service not found" }, { status: 400 });

  const tags = normalizeTags(body.tags);
  const serviceRegion = publicRegionForService(service.region, service.ipAddress);
  const geo = await geolocateServerIp(service.ipAddress ?? null, { regionHint: serviceRegion }).catch((error) => {
    console.warn("DZN server GeoIP lookup skipped", error instanceof Error ? error.message : "unknown error");
    return null;
  });
  const existingSameService = await db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE nitrado_service_id = ?
         AND lower(COALESCE(status, 'pending')) != 'merged'
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       ORDER BY
         CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN 0 ELSE 1 END,
         updated_at DESC,
         created_at DESC
       LIMIT 1`,
    )
    .bind(service.id)
    .first<{ id: string }>();
  const existingDraft = existingSameService
    ? null
    : await db
        .prepare(
          `SELECT id
           FROM linked_servers
           WHERE user_id = ?
             AND lower(COALESCE(status, 'pending')) = 'pending'
             AND (nitrado_service_id IS NULL OR nitrado_service_id = '')
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`,
        )
        .bind(userId)
        .first<{ id: string }>();

  let linkedServerId: string;
  if (existingSameService || existingDraft) {
    linkedServerId = (existingSameService ?? existingDraft)?.id ?? "";
    const slug = await uniquePublicSlug(env, service.name, linkedServerId);
    await db
      .prepare(
        `UPDATE linked_servers SET
          user_id = ?,
          guild_id = ?,
          discord_guild_id = ?,
          nitrado_service_id = ?,
          nitrado_service_name = ?,
          server_name = ?,
          server_type = ?,
          tags_json = ?,
          region = ?,
          game = ?,
          platform = ?,
          ip_address = ?,
          player_slots = ?,
          geo_latitude = ?,
          geo_longitude = ?,
          geo_country = ?,
          geo_region = ?,
          geo_city = ?,
          geo_timezone = ?,
          geo_source = ?,
          geo_last_checked_at = ?,
          status = CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN status ELSE 'pending' END,
          public_slug = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
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
        serviceRegion,
        service.game ?? null,
        service.platform ?? null,
        service.ipAddress ?? null,
        service.playerSlots ?? null,
        geo?.latitude ?? null,
        geo?.longitude ?? null,
        geo?.country ?? null,
        geo?.region ?? null,
        geo?.city ?? null,
        geo?.timezone ?? null,
        geo?.source ?? null,
        geo ? new Date().toISOString() : null,
        slug,
        linkedServerId,
      )
      .run();
    if (geo) console.log("DZN SERVER GEO LOCATION UPDATED", { linkedServerId, source: geo.source, approximate: geo.approximate });
  } else {
    const limit = await getServerLinkLimitForUser(env, userId);
    const currentCount = await countLinkedServersForUser(env, userId);
    if (typeof limit === "number" && currentCount >= limit) {
      return json({ error: "Server link limit reached. Upgrade your plan to add another server." }, { status: 402 });
    }

    linkedServerId = crypto.randomUUID();
    const slug = await uniquePublicSlug(env, service.name, linkedServerId);
    await db
      .prepare(
        `INSERT INTO linked_servers (
          id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name,
          server_name, server_type, tags_json, region, game, platform, ip_address, player_slots,
          geo_latitude, geo_longitude, geo_country, geo_region, geo_city, geo_timezone, geo_source, geo_last_checked_at,
          status, public_slug, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        linkedServerId,
        userId,
        guild.guild_id,
        guild.id,
        service.id,
        service.name,
        service.name,
        body.serverType,
        JSON.stringify(tags),
        serviceRegion,
        service.game ?? null,
        service.platform ?? null,
        service.ipAddress ?? null,
        service.playerSlots ?? null,
        geo?.latitude ?? null,
        geo?.longitude ?? null,
        geo?.country ?? null,
        geo?.region ?? null,
        geo?.city ?? null,
        geo?.timezone ?? null,
        geo?.source ?? null,
        geo ? new Date().toISOString() : null,
        slug,
      )
      .run();
    if (geo) console.log("DZN SERVER GEO LOCATION UPDATED", { linkedServerId, source: geo.source, approximate: geo.approximate });
  }

  await linkLatestNitradoConnection(env, userId, linkedServerId);
  return json({ ok: true, linkedServerId });
};

function publicRegionForService(region: string | null | undefined, ipAddress: string | null | undefined) {
  const trimmed = typeof region === "string" ? region.trim() : "";
  if (!trimmed) return null;
  return normalizeIp(trimmed) === normalizeIp(ipAddress) ? null : trimmed;
}
