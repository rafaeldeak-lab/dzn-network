import {
  getOwnerDiscordChannelMappings,
  saveOwnerDiscordChannelMapping,
} from "../../../_lib/owner-discord-control";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

type SaveChannelMappingBody = {
  slot?: unknown;
  guild_id?: unknown;
  guildId?: unknown;
  guild_name?: unknown;
  guildName?: unknown;
  channel_id?: unknown;
  channelId?: unknown;
  channel_name?: unknown;
  channelName?: unknown;
  reason?: unknown;
  request_id?: unknown;
  requestId?: unknown;
};

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  return json({
    ok: true,
    mappings: await getOwnerDiscordChannelMappings(env),
    productionSendingDisabled: true,
    autoPostingEnabled: false,
  });
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  const body = await readJson<SaveChannelMappingBody>(request);
  const result = await saveOwnerDiscordChannelMapping(env, auth.user, {
    slot: body.slot,
    guildId: body.guildId ?? body.guild_id,
    guildName: body.guildName ?? body.guild_name,
    channelId: body.channelId ?? body.channel_id,
    channelName: body.channelName ?? body.channel_name,
    reason: body.reason,
    requestId: body.requestId ?? body.request_id,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, { status: result.status });

  return json({
    ok: true,
    mapping: result.mapping,
    mappings: await getOwnerDiscordChannelMappings(env),
    productionSendingDisabled: true,
    autoPostingEnabled: false,
  });
};

export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
