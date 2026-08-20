import { ensureLinkedServerMetadataColumns, getSessionUser, requireDb } from "../../_lib/db";
import { geolocateServerIp, normalizeIp } from "../../_lib/geoip";
import { json, methodNotAllowed, readJson } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { fetchMockNitradoServiceById, fetchNitradoServiceById, NitradoServiceLookupError } from "../../_lib/nitrado";
import {
  assertLinkedServerOwnedByUser,
  completeLinkedServerAllowanceReservation,
  getActiveLinkedServerAllowanceReservation,
  getNitradoTokenForLinkedServer,
  LinkedServerAllowanceExceededError,
  LinkedServerOwnershipError,
  NitradoServiceAlreadyLinkedError,
  linkedServerAllowanceLimitMessage,
  normalizeTags,
  releaseLinkedServerAllowanceReservation,
  saveLinkedServerNitradoService,
  uniquePublicSlug,
  validateServerType,
  type LinkedServerNitradoServiceAttachmentResult,
} from "../../_lib/onboarding";
import { validatePublicListingInput, type PublicListingInput } from "../../_lib/review-moderation";
import { recordDiscordServerAnnouncementEvent } from "../../_lib/discord-server-announcements";
import { ensureAutomationRowsForLinkedServers } from "../../_lib/automation";
import { saveBotOnboardingConfig } from "../../_lib/ctf-tournaments";
import { normalizeServerCategory } from "../../_lib/server-categories";
import type { PagesFunction } from "../../_lib/types";

type SaveBody = {
  linkedServerId?: string;
  discordGuildId?: string;
  serverType?: string;
  server_category?: string | null;
  tags?: string[];
  nitradoServiceId?: string;
  tournamentChannelId?: string;
  botAccessToken?: string;
} & PublicListingInput;

export const onRequest: PagesFunction = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user && !isMockAuth(env.MOCK_AUTH)) return json({ error: "Unauthorized" }, { status: 401 });
  if (!user) return json({ error: "Authenticated user is required" }, { status: 401 });

  const body = await readJson<SaveBody>(request);
  const sourceLinkedServerId = sanitizeLinkedServerId(body.linkedServerId);
  if (!sourceLinkedServerId || !body.discordGuildId || !body.nitradoServiceId || !body.serverType) {
    return json({ error: "Missing onboarding fields" }, { status: 400 });
  }
  if (!validateServerType(body.serverType)) return json({ error: "Invalid server type" }, { status: 400 });
  const serverCategory = typeof body.server_category === "string" && body.server_category.trim()
    ? normalizeServerCategory(body.server_category)
    : null;
  if (body.server_category && !serverCategory) return json({ error: "Invalid server category" }, { status: 400 });

  const userId = user.id;
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  const guild = await db
    .prepare("SELECT id, guild_id, name FROM discord_guilds WHERE guild_id = ? AND owner_user_id = ? LIMIT 1")
    .bind(body.discordGuildId, userId)
    .first<{ id: string; guild_id: string; name: string }>();
  if (!guild) return json({ error: "Discord guild not found" }, { status: 400 });

  try {
    await assertLinkedServerOwnedByUser(env, userId, sourceLinkedServerId);
  } catch (error) {
    if (error instanceof LinkedServerOwnershipError) {
      return json({ error: "Linked server not found", error_code: error.code }, { status: 404 });
    }
    throw error;
  }

  let exactToken = "";
  try {
    const resolvedToken = await getNitradoTokenForLinkedServer(env, userId, sourceLinkedServerId);
    if (!resolvedToken) {
      return json({
        error: "No saved Nitrado token was found for this linked server. Re-save your Nitrado long-life token.",
        error_code: "missing_nitrado_token",
      }, { status: 400 });
    }
    exactToken = resolvedToken;
  } catch (error) {
    const tokenError = classifyNitradoTokenError(error);
    return json({ error: tokenError.message, error_code: tokenError.code }, { status: tokenError.status });
  }

  let service;
  try {
    service = isMockNitrado(env.MOCK_NITRADO)
      ? await fetchMockNitradoServiceById(body.nitradoServiceId)
      : await fetchNitradoServiceById(exactToken, body.nitradoServiceId);
  } catch (error) {
    if (error instanceof NitradoServiceLookupError) return nitradoLookupResponse(error);
    return json({ error: "Nitrado API unavailable" }, { status: 503 });
  }
  if (!service) return json({ error: "DayZ Nitrado service not found" }, { status: 400 });

  const tags = normalizeTags(body.tags);
  const publicListing = validatePublicListingInput(body);
  if (!publicListing.ok) return json({ error: publicListing.error }, { status: 400 });
  const publicListingUpdatedAt = hasPublicListingValue(publicListing.value) ? new Date().toISOString() : null;
  const serviceRegion = publicRegionForService(service.region, service.ipAddress);
  const geo = await geolocateServerIp(service.ipAddress ?? null, { regionHint: serviceRegion }).catch((error) => {
    console.warn("DZN server GeoIP lookup skipped", error instanceof Error ? error.message : "unknown error");
    return null;
  });

  let attachment: LinkedServerNitradoServiceAttachmentResult | null = null;
  try {
    attachment = await saveLinkedServerNitradoService(env, userId, sourceLinkedServerId, service, body.serverType, tags, serverCategory, {
      finalizeReservation: false,
    });
    const linkedServerId = attachment.linkedServerId;
    const slug = await uniquePublicSlug(env, service.name, linkedServerId);
    const updateResult = await db
      .prepare(
        `UPDATE linked_servers SET
          guild_id = ?,
          discord_guild_id = ?,
          nitrado_service_id = ?,
          nitrado_service_name = ?,
          server_name = ?,
          server_type = ?,
          server_category = COALESCE(?, server_category),
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
          public_short_description = ?,
          public_description = ?,
          public_discord_invite = ?,
          public_website_url = ?,
          public_rules = ?,
          public_language = ?,
          public_region_label = ?,
          public_listing_updated_at = ?,
          status = CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN status ELSE 'pending' END,
          public_slug = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND user_id = ?`,
      )
      .bind(
        guild.guild_id,
        guild.id,
        service.id,
        service.name,
        service.name,
        body.serverType,
        serverCategory,
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
        publicListing.value.public_short_description,
        publicListing.value.public_description,
        publicListing.value.public_discord_invite,
        publicListing.value.public_website_url,
        publicListing.value.public_rules,
        publicListing.value.public_language,
        publicListing.value.public_region_label,
        publicListingUpdatedAt,
        slug,
        linkedServerId,
        userId,
      )
      .run();
    if (runChanges(updateResult) < 1) throw new LinkedServerOwnershipError();
    if (geo) console.log("DZN SERVER GEO LOCATION UPDATED", { linkedServerId, source: geo.source, approximate: geo.approximate });

    await saveBotOnboardingConfig(env, {
      linkedServerId,
      discordGuildId: guild.guild_id,
      tournamentChannelId: body.tournamentChannelId,
      botAccessToken: body.botAccessToken,
    });
    await ensureAutomationRowsForLinkedServers(env);
    await finalizeAttachmentReservation(env, userId, attachment, linkedServerId);

    const createdNewLinkedServer = attachment.createdNewCanonicalServer;
    if (createdNewLinkedServer) {
      waitUntil(
        recordDiscordServerAnnouncementEvent(env, {
          eventType: "new_server",
          serverId: linkedServerId,
          reason: "onboarding_server_created",
        }).catch((error) => {
          console.warn("DZN Discord server announcement skipped", {
            linkedServerId,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }),
      );
    }

    return json({ ok: true, linkedServerId });
  } catch (error) {
    await releasePendingAttachmentReservation(env, userId, attachment, sourceLinkedServerId).catch(() => null);
    if (error instanceof LinkedServerAllowanceExceededError) {
      return json({ error: linkedServerAllowanceLimitMessage(error.limit) }, { status: 402 });
    }
    if (error instanceof NitradoServiceAlreadyLinkedError) {
      return json({
        error: "This Nitrado service is already linked to another DZN owner.",
        error_code: error.code,
      }, { status: 409 });
    }
    if (error instanceof LinkedServerOwnershipError) {
      return json({ error: "Linked server not found", error_code: error.code }, { status: 404 });
    }
    return json({ error: "Unable to save onboarding" }, { status: 500 });
  }
};

async function finalizeAttachmentReservation(
  env: Parameters<PagesFunction>[0]["env"],
  userId: string,
  attachment: LinkedServerNitradoServiceAttachmentResult,
  linkedServerId: string,
) {
  if (attachment.pendingReservationAction === "complete") {
    const reservation = await getActiveLinkedServerAllowanceReservation(env, userId, linkedServerId)
      ?? await getActiveLinkedServerAllowanceReservation(env, userId, attachment.sourceLinkedServerId);
    if (reservation) {
      await completeLinkedServerAllowanceReservation(env, reservation.id, linkedServerId);
    }
    return;
  }
  if (attachment.pendingReservationAction === "release") {
    await releaseLinkedServerAllowanceReservation(env, {
      userId,
      linkedServerId: attachment.sourceLinkedServerId,
      reason: "same_owner_canonical_reuse",
    });
  }
}

async function releasePendingAttachmentReservation(
  env: Parameters<PagesFunction>[0]["env"],
  userId: string,
  attachment: LinkedServerNitradoServiceAttachmentResult | null,
  fallbackLinkedServerId: string,
) {
  if (!attachment) {
    await releaseLinkedServerAllowanceReservation(env, {
      userId,
      linkedServerId: fallbackLinkedServerId,
      reason: "onboarding_save_failed",
    });
    return;
  }
  const linkedServerId = attachment.pendingReservationAction === "complete"
    ? attachment.linkedServerId
    : attachment.sourceLinkedServerId;
  await releaseLinkedServerAllowanceReservation(env, {
    userId,
    linkedServerId,
    reason: "onboarding_save_failed",
  });
}

function sanitizeLinkedServerId(value?: string) {
  const id = value?.trim();
  return id && id.length <= 120 ? id : null;
}

function nitradoLookupResponse(error: NitradoServiceLookupError) {
  if (error.code === "invalid_token") return json({ error: "Invalid token", tokenValid: false }, { status: 400 });
  if (error.code === "service_not_found") return json({ error: "Service ID not found" }, { status: 404 });
  if (error.code === "access_denied") return json({ error: "Token does not have access to this service" }, { status: 403 });
  if (error.code === "not_dayz") return json({ error: "This service does not look like a DayZ server" }, { status: 400 });
  return json({ error: "Nitrado API unavailable" }, { status: 503 });
}

function classifyNitradoTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/TOKEN_ENCRYPTION_KEY is not configured/i.test(message)) {
    return {
      status: 500,
      code: "missing_token_encryption_key",
      message: "Token encryption key is missing in production. Add TOKEN_ENCRYPTION_KEY in Cloudflare Pages and redeploy.",
    };
  }
  if (/decrypt|operation|authentication|tag|cipher|iv|key/i.test(message)) {
    return {
      status: 500,
      code: "token_decrypt_failed",
      message: "Your saved Nitrado token cannot be decrypted. Re-save your Nitrado long-life token.",
    };
  }
  return {
    status: 500,
    code: "nitrado_token_unavailable",
    message: "DZN could not read the saved Nitrado token. Re-save your Nitrado long-life token and try again.",
  };
}

function runChanges(result: unknown) {
  const changes = (result as { meta?: { changes?: unknown } })?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

function publicRegionForService(region: string | null | undefined, ipAddress: string | null | undefined) {
  const trimmed = typeof region === "string" ? region.trim() : "";
  if (!trimmed) return null;
  return normalizeIp(trimmed) === normalizeIp(ipAddress) ? null : trimmed;
}

function hasPublicListingValue(value: {
  public_short_description: string | null;
  public_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  public_rules: string | null;
  public_language: string | null;
  public_region_label: string | null;
}) {
  return Object.values(value).some((item) => typeof item === "string" && item.trim());
}
