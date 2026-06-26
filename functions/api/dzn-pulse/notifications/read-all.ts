import {
  markAllNotificationsRead,
  PULSE_NO_STORE_HEADERS,
  pulseFeatureDisabledPayload,
  resolvePulseUser,
} from "../../../_lib/dzn-pulse";
import { isDznPulseEnabled } from "../../../_lib/feature-flags";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  if (!isDznPulseEnabled(env)) return json(pulseFeatureDisabledPayload(), { status: 404, headers: PULSE_NO_STORE_HEADERS });
  const user = await resolvePulseUser(env, request);
  if (!user) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: PULSE_NO_STORE_HEADERS });
  const result = await markAllNotificationsRead(env, user);
  return json(result, { status: result.status, headers: PULSE_NO_STORE_HEADERS });
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
