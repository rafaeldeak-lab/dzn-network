import { requireCronSecret } from "../../../_lib/cron-auth";
import { requireDb } from "../../../_lib/db";
import { readDznCommsRetentionFlags, runDznCommsRetention } from "../../../_lib/dzn-comms-live";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  if (!readDznCommsRetentionFlags(env, request).enabled) {
    return json({ ok: false, code: "DZN_COMMS_RETENTION_DISABLED" }, { status: 404 });
  }
  const result = await runDznCommsRetention(requireDb(env));
  return json({ ok: true, ...result });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPatch = onRequestGet;
export const onRequestPut = onRequestGet;
export const onRequestDelete = onRequestGet;
