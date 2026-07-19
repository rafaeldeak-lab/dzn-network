import { sendOwnerDiscordTestEmbed } from "../../../_lib/owner-discord-control";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

type TestEmbedBody = {
  slot?: unknown;
  type?: unknown;
  confirmation?: unknown;
  preview_only?: unknown;
  previewOnly?: unknown;
  reason?: unknown;
  request_id?: unknown;
  requestId?: unknown;
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  const body = await readJson<TestEmbedBody>(request);
  const result = await sendOwnerDiscordTestEmbed(env, auth.user, {
    slot: body.slot,
    type: body.type,
    confirmation: body.confirmation,
    previewOnly: body.previewOnly ?? body.preview_only,
    reason: body.reason,
    requestId: body.requestId ?? body.request_id,
  });
  if (!result.ok) {
    return json({
      ok: false,
      error: result.error,
      permissionCheck: "permissionCheck" in result ? result.permissionCheck : undefined,
      preview: "preview" in result ? result.preview : undefined,
      productionSendingDisabled: true,
      autoPostingEnabled: false,
    }, { status: result.status });
  }

  return json({
    ok: true,
    sent: result.sent,
    mode: result.mode,
    preview: result.preview,
    permissionCheck: result.permissionCheck,
    messageId: result.messageId,
    productionSendingDisabled: true,
    autoPostingEnabled: false,
  });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
