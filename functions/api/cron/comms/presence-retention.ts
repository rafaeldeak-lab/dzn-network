import { requireCronSecret } from "../../../_lib/cron-auth";
import { D1PresenceStorage, cleanupExpiredPresence, readDznCommsPresenceFlags } from "../../../_lib/dzn-comms-presence";
import { requireDb } from "../../../_lib/db";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  if (!readDznCommsPresenceFlags(env, request).retentionEnabled) {
    return json({ ok: false, code: "DZN_COMMS_PRESENCE_RETENTION_DISABLED" }, { status: 404 });
  }
  const result = await cleanupExpiredPresence(new D1PresenceStorage(requireDb(env)));
  return json({ ok: true, ...result });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPatch = onRequestGet;
export const onRequestPut = onRequestGet;
export const onRequestDelete = onRequestGet;
