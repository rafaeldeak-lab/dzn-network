import {
  clearReadNotifications,
  PULSE_NO_STORE_HEADERS,
  pulseFeatureDisabledPayload,
  resolvePulseUser,
} from "../../../_lib/dzn-pulse";
import { isDznPulseEnabled } from "../../../_lib/feature-flags";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

async function handle(request: Request, env: Parameters<PagesFunction>[0]["env"]) {
  if (!isDznPulseEnabled(env)) return json(pulseFeatureDisabledPayload(), { status: 404, headers: PULSE_NO_STORE_HEADERS });
  const user = await resolvePulseUser(env, request);
  if (!user) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: PULSE_NO_STORE_HEADERS });
  const result = await clearReadNotifications(env, user);
  return json(result, { status: result.status, headers: PULSE_NO_STORE_HEADERS });
}

export const onRequestPost: PagesFunction = ({ request, env }) => handle(request, env);
export const onRequestDelete: PagesFunction = ({ request, env }) => handle(request, env);
export const onRequestGet: PagesFunction = () => methodNotAllowed();
