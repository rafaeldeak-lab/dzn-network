import { requireCronSecret } from "../../../_lib/cron-auth";
import { json, methodNotAllowed } from "../../../_lib/http";
import { dispatchQueuedPlayerGameIdentityNotifications } from "../../../_lib/player-game-identity-notifications";
import type { PagesFunction } from "../../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;

  const result = await dispatchQueuedPlayerGameIdentityNotifications(env, { maxJobs: 20 });
  return json(result, {
    status: result.ok ? 200 : 503,
    headers: {
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
};
