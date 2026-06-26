import {
  getPulseSummary,
  PULSE_NO_STORE_HEADERS,
  pulseFeatureDisabledPayload,
  resolvePulseUser,
} from "../../_lib/dzn-pulse";
import { isDznPulseEnabled } from "../../_lib/feature-flags";
import { json } from "../../_lib/http";
import type { PagesFunction } from "../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  if (!isDznPulseEnabled(env)) return json(pulseFeatureDisabledPayload(), { status: 404, headers: PULSE_NO_STORE_HEADERS });
  const user = await resolvePulseUser(env, request);
  if (!user) return json({ ok: false, error: "unauthorized", message: "Log in to view DZN Pulse." }, { status: 401, headers: PULSE_NO_STORE_HEADERS });
  return json(await getPulseSummary(env, user), { headers: PULSE_NO_STORE_HEADERS });
};
