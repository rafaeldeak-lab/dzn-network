import {
  listUserNotifications,
  PULSE_NO_STORE_HEADERS,
  pulseFeatureDisabledPayload,
  resolvePulseUser,
} from "../../../_lib/dzn-pulse";
import { isDznPulseEnabled } from "../../../_lib/feature-flags";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  if (!isDznPulseEnabled(env)) return json(pulseFeatureDisabledPayload(), { status: 404, headers: PULSE_NO_STORE_HEADERS });
  const user = await resolvePulseUser(env, request);
  if (!user) return json({ ok: false, error: "unauthorized", message: "Log in to view DZN Pulse notifications." }, { status: 401, headers: PULSE_NO_STORE_HEADERS });
  const url = new URL(request.url);
  const payload = await listUserNotifications(env, user, {
    filter: url.searchParams.get("filter"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  });
  return json(payload, { headers: PULSE_NO_STORE_HEADERS });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
