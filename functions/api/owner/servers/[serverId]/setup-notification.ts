import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { sendOwnerSetupRecommendation } from "../../../../_lib/owner-setup-notifications";
import { requirePlatformOwner } from "../../../../_lib/platform-owner";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = async ({ env, request, params }) => {
  const auth = await requirePlatformOwner(env, request);
  if (!auth.ok) return auth.response;
  if (!sameOrigin(request)) return json({ ok: false, error: "forbidden", message: "Cross-origin setup reminders are not allowed." }, { status: 403 });
  const body = await readJson<{ confirmation?: unknown }>(request);
  if (body.confirmation !== "SEND_SETUP_REMINDER") {
    return json({ ok: false, error: "confirmation_required", message: "Confirm the setup reminder before sending." }, { status: 400 });
  }
  const serverId = String(params.serverId ?? "").trim();
  const result = await sendOwnerSetupRecommendation(env, serverId);
  if (!result.ok) return json({ ok: false, error: result.error, message: result.error === "no_setup_blockers" ? "This server has no current setup blockers." : "The setup reminder could not be created." }, { status: result.status });
  return json({ ok: true, website: result.website, discord: result.discord, message: result.discord === "delivered" ? "Website and Discord setup reminders sent." : "Website setup reminder sent; Discord was not delivered." });
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export const onRequestGet = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
