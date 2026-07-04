import {
  getOwnerDiscordChannelMappings,
  runOwnerDiscordPermissionCheck,
} from "../../../../../_lib/owner-discord-control";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { requirePlatformOwner } from "../../../../../_lib/platform-owner";
import type { PagesFunction } from "../../../../../_lib/types";

type PermissionCheckBody = {
  reason?: unknown;
  request_id?: unknown;
  requestId?: unknown;
};

export const onRequestPost: PagesFunction = async ({ env, request, params }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  const body = await readJson<PermissionCheckBody>(request);
  const result = await runOwnerDiscordPermissionCheck(env, auth.user, {
    slot: params.slot,
    reason: body.reason,
    requestId: body.requestId ?? body.request_id,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, { status: result.status });

  return json({
    ok: true,
    permissionCheck: result.permissionCheck,
    mapping: result.mapping,
    mappings: await getOwnerDiscordChannelMappings(env),
    productionSendingDisabled: true,
    autoPostingEnabled: false,
  });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
