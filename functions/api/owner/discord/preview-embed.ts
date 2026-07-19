import { buildOwnerDiscordPreviewEmbed } from "../../../_lib/owner-discord-control";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { requirePlatformOwner } from "../../../_lib/platform-owner";
import type { PagesFunction } from "../../../_lib/types";

type PreviewRequest = {
  type?: unknown;
  title?: unknown;
  description?: unknown;
  colorHex?: unknown;
};

export const onRequestPost: PagesFunction = async ({ env, request }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;

  const body = await readJson<PreviewRequest>(request);
  return json({
    ok: true,
    preview: buildOwnerDiscordPreviewEmbed(env, body),
    sent: false,
    mode: "preview_only",
  });
};

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
