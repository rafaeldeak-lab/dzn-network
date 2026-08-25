import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import {
  getPlayerProfilePrivacyPreferences,
  playerProfilePrivacyFairness,
  savePlayerProfilePrivacyPreferences,
  type PlayerProfilePrivacyPreferencePatch,
} from "../../_lib/player-profile-privacy";
import { buildPublicProfileAppearancePreview } from "../../_lib/public-profile-attribution";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

const BODY_LIMIT_BYTES = 2048;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (!["GET", "PATCH"].includes(request.method)) return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) {
    return json({ error: "Unauthorized" }, { status: 401, headers: privateNoStoreHeaders() });
  }

  if (request.method === "GET") return readPreferences(env, user);

  const bodyResult = await readBoundedJson<PlayerProfilePrivacyPreferencePatch>(request, BODY_LIMIT_BYTES);
  if (!bodyResult.ok) {
    return json({ ok: false, error: bodyResult.error, message: bodyResult.message }, {
      status: bodyResult.status,
      headers: privateNoStoreHeaders(),
    });
  }

  const result = await savePlayerProfilePrivacyPreferences(env, user, bodyResult.value);
  return json({
    ...result.payload,
    profile_attribution: buildPublicProfileAppearancePreview(result.payload.privacy),
  }, { status: result.status, headers: privateNoStoreHeaders() });
};

async function readPreferences(env: Env, user: SessionUser) {
  const privacy = await getPlayerProfilePrivacyPreferences(env, user);
  return json({
    ok: true,
    privacy,
    profile_attribution: buildPublicProfileAppearancePreview(privacy),
    fairness: playerProfilePrivacyFairness(),
  }, {
    headers: privateNoStoreHeaders(),
  });
}
