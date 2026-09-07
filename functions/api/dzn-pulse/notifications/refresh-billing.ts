import { getSessionUser } from "../../../_lib/db";
import { refreshPaymentSetupNotice } from "../../../_lib/billing-reminders";
import { isBillingRemindersEnabled } from "../../../_lib/feature-flags";
import { PULSE_NO_STORE_HEADERS } from "../../../_lib/dzn-pulse";
import { json, methodNotAllowed } from "../../../_lib/http";
import type { PagesFunction } from "../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  if (!isBillingRemindersEnabled(env)) return json({ ok: false, error: "billing_reminders_disabled" }, { status: 404, headers: PULSE_NO_STORE_HEADERS });
  const user = await getSessionUser(env, request);
  if (!user) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: PULSE_NO_STORE_HEADERS });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return json({ ok: false, error: "invalid_origin" }, { status: 403, headers: PULSE_NO_STORE_HEADERS });
  }
  try {
    await refreshPaymentSetupNotice(env, user);
    return json({ ok: true }, { headers: PULSE_NO_STORE_HEADERS });
  } catch {
    return json({ ok: false, error: "billing_reminder_unavailable" }, { status: 503, headers: PULSE_NO_STORE_HEADERS });
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
